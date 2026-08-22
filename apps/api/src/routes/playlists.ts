/**
 * Playlists.
 *
 * Every row here belongs to exactly one account, and every query is scoped by
 * `requireUser(request).id` — the id from the verified session, never from the
 * request. That is this API's authorization boundary, standing in for the
 * row-level security that cannot apply when the server connects with a
 * privileged role.
 *
 * The subtlety worth naming: a playlist id is a bearer of nothing. Item routes
 * take one in the path, so each of them proves ownership *before* touching an
 * item — otherwise anyone holding a stranger's id could add episodes to their
 * playlist, and "not found" would be the only honest thing to return anyway.
 *
 * The one exception is the banner image, which is served from an unguessable
 * URL rather than from a session. See the route for why, and for what that
 * costs.
 */

import { generateKey } from '@cue/core';
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  episodes,
  paginate,
  playlistBanners,
  playlistItems,
  playlistPodcasts,
  playlists,
  podcasts,
} from '@cue/db';
import type { Playlist, PlaylistColor, PlaylistKind } from '@cue/types';
import {
  addPodcastToPlaylistInput,
  addToPlaylistInput,
  createPlaylistInput,
  PLAYLIST_IMAGE_HEIGHT,
  PLAYLIST_IMAGE_MAX_BYTES,
  PLAYLIST_IMAGE_TYPES,
  PLAYLIST_IMAGE_WIDTH,
  PLAYLIST_ITEMS_MAX,
  PLAYLIST_MAX,
  paginationQuery,
  playlistKind,
  reorderPlaylistInput,
  reorderPlaylistPodcastsInput,
  updatePlaylistInput,
  uuidParam,
} from '@cue/validation';
import { and, asc, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { requireUser } from '../auth/plugin.ts';
import { serializeEpisode, serializePodcast } from '../catalog/serialize.ts';
import { AppError, badRequest, notFound, ok } from '../errors.ts';

/**
 * How many covers a tile stacks.
 *
 * Four, because that is what a 2×2 stack holds and what reads as "a collection"
 * rather than "one episode's artwork with a border".
 */
const COVER_COUNT = 4;

const itemParams = z.object({ id: z.uuid(), episodeId: z.uuid() });
const podcastItemParams = z.object({ id: z.uuid(), podcastId: z.uuid() });
const bannerParams = z.object({ id: z.uuid(), version: z.uuid() });
const listQuery = paginationQuery.extend({ kind: playlistKind.optional() });

/**
 * Adding the wrong sort of thing to a playlist.
 *
 * A `conflict` rather than a `bad_request`, because the request is well-formed
 * and the caller is not confused about the API — the playlist is simply the
 * wrong shape for what they are holding, which is a state, not a syntax error.
 *
 * The discriminator rides in `fields` so the client can recognise this exact
 * situation and offer to make the right playlist instead. Matching on the prose
 * would break the first time the wording changed, which is the whole reason
 * this API's errors carry codes.
 */
function wrongKind(playlistThatKind: PlaylistKind): AppError {
  return playlistThatKind === 'episode'
    ? new AppError(
        'conflict',
        'A whole show cannot be saved into an episode playlist',
        { fields: { kind: 'episode', expected: 'podcast' } },
      )
    : new AppError(
        'conflict',
        'A single episode cannot be saved into a show playlist',
        { fields: { kind: 'podcast', expected: 'episode' } },
      );
}

export function playlistRoutes(app: FastifyInstance): void {
  registerImageParser(app);

  /**
   * Contents summary: how many items, and the first few covers.
   *
   * A joined subquery rather than two correlated ones. The obvious shape —
   * `(SELECT count(*) …)` beside `(SELECT array_agg(…) …)` in the projection —
   * does not survive contact with Drizzle: it renders a column inside a `sql`
   * template *unqualified* when the outer query has no join, so
   * `coalesce(artwork_url, artwork_url)` inside the subquery becomes ambiguous
   * and `playlist_items.playlist_id = playlists.id` silently compares a column
   * to itself. Joining a subquery keeps every reference inside a query that has
   * joins of its own, where the qualification is not in question.
   *
   * The array is sliced in the database rather than in JS: a hundred playlists
   * of five hundred episodes would otherwise ship fifty thousand URLs across
   * the wire to draw a hundred tiles.
   */
  const contents = app.db
    .select({
      playlistId: playlistItems.playlistId,
      total: count().as('total'),
      artworkUrls: sql<string[] | null>`(
        array_agg(
          coalesce(${episodes.artworkUrl}, ${podcasts.artworkUrl})
          ORDER BY ${playlistItems.sortKey}
        ) FILTER (
          WHERE coalesce(${episodes.artworkUrl}, ${podcasts.artworkUrl}) IS NOT NULL
        )
      )[1:${sql.raw(String(COVER_COUNT))}]`.as('artwork_urls'),
    })
    .from(playlistItems)
    .innerJoin(episodes, eq(episodes.id, playlistItems.episodeId))
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .groupBy(playlistItems.playlistId)
    .as('contents');

  /**
   * The same summary for show playlists.
   *
   * A second subquery rather than a union, because the two are joined to the
   * same outer row and exactly one of them ever matches — `kind` guarantees a
   * playlist has rows in one item table or the other, never both. Coalescing
   * the pair below is what turns that into a single `itemCount`.
   */
  const podcastContents = app.db
    .select({
      playlistId: playlistPodcasts.playlistId,
      total: count().as('podcast_total'),
      artworkUrls: sql<string[] | null>`(
        array_agg(${podcasts.artworkUrl} ORDER BY ${playlistPodcasts.sortKey})
          FILTER (WHERE ${podcasts.artworkUrl} IS NOT NULL)
      )[1:${sql.raw(String(COVER_COUNT))}]`.as('podcast_artwork_urls'),
    })
    .from(playlistPodcasts)
    .innerJoin(podcasts, eq(podcasts.id, playlistPodcasts.podcastId))
    .groupBy(playlistPodcasts.playlistId)
    .as('podcast_contents');

  /** This user's playlists, most recently touched first. */
  app.get('/me/playlists', async (request) => {
    const user = requireUser(request);
    const query = listQuery.parse(request.query);
    const limit = clampLimit(query.limit);

    const cursor = decodeCursor(query.cursor);
    const keyset = cursor
      ? or(
          lt(playlists.updatedAt, new Date(cursor.sortValue)),
          and(eq(playlists.updatedAt, new Date(cursor.sortValue)), lt(playlists.id, cursor.id)),
        )
      : undefined;

    // The Library shows episode and show playlists under separate tabs, so the
    // filter belongs here rather than in the client — paging a mixed list and
    // then discarding half of each page would make "20 per page" mean nothing.
    const scope = query.kind
      ? and(eq(playlists.userId, user.id), eq(playlists.kind, query.kind))
      : eq(playlists.userId, user.id);

    const rows = await app.db
      .select({
        playlist: playlists,
        episodeCount: contents.total,
        artworkUrls: contents.artworkUrls,
        podcastCount: podcastContents.total,
        podcastArtworkUrls: podcastContents.artworkUrls,
        bannerVersion: playlistBanners.version,
      })
      .from(playlists)
      // Left, not inner: an empty playlist is a playlist, and an inner join
      // would drop every one of them from the list that exists to show them.
      .leftJoin(contents, eq(contents.playlistId, playlists.id))
      .leftJoin(podcastContents, eq(podcastContents.playlistId, playlists.id))
      // Only the version, never the bytes — see `playlistBanners`.
      .leftJoin(playlistBanners, eq(playlistBanners.playlistId, playlists.id))
      .where(keyset ? and(scope, keyset) : scope)
      .orderBy(desc(playlists.updatedAt), desc(playlists.id))
      .limit(limit + 1);

    const page = paginate(rows, limit, (row) =>
      encodeCursor(row.playlist.updatedAt, row.playlist.id),
    );

    return ok({
      items: page.items.map((row) =>
        serializePlaylist(row.playlist, row.bannerVersion, {
          episodes: { total: row.episodeCount ?? 0, artworkUrls: row.artworkUrls ?? [] },
          podcasts: {
            total: row.podcastCount ?? 0,
            artworkUrls: row.podcastArtworkUrls ?? [],
          },
        }),
      ),
      nextCursor: page.nextCursor,
    });
  });

  app.post('/me/playlists', async (request, reply) => {
    const user = requireUser(request);
    const input = createPlaylistInput.parse(request.body);

    /**
     * A ceiling, not a product limit.
     *
     * Nobody curating podcasts reaches a hundred playlists; a script does it in
     * a second. Checked before the insert rather than enforced by a constraint
     * because the answer a person needs is a sentence, not a unique violation.
     */
    const [existing] = await app.db
      .select({ total: count() })
      .from(playlists)
      .where(eq(playlists.userId, user.id));

    if ((existing?.total ?? 0) >= PLAYLIST_MAX) {
      throw badRequest(`You can keep up to ${PLAYLIST_MAX} playlists`);
    }

    const [row] = await app.db
      .insert(playlists)
      .values({
        userId: user.id,
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        ...(input.color ? { color: input.color } : {}),
        ...(input.bannerText === undefined ? {} : { bannerText: input.bannerText }),
      })
      .returning();

    if (!row) throw badRequest('The playlist could not be created');

    void reply.status(201);
    return ok({ playlist: serializePlaylist(row, null, empty) });
  });

  /** One playlist, with its contents in order. */
  app.get('/me/playlists/:id', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);

    const playlist = await own(app, user.id, id);
    const bannerVersion = await bannerVersionOf(app, id);

    // Only the table this playlist's kind actually uses is read. The other is
    // empty by construction, and a query that proves that is a query nobody
    // needed to run.
    if (playlist.kind === 'podcast') {
      const rows = await app.db
        .select({ podcast: podcasts })
        .from(playlistPodcasts)
        .innerJoin(podcasts, eq(podcasts.id, playlistPodcasts.podcastId))
        .where(eq(playlistPodcasts.playlistId, id))
        .orderBy(asc(playlistPodcasts.sortKey));

      return ok({
        playlist: {
          ...serializePlaylist(playlist, bannerVersion, {
            episodes: emptySide,
            podcasts: {
              total: rows.length,
              artworkUrls: rows
                .map((row) => row.podcast.artworkUrl)
                .filter((url): url is string => url !== null)
                .slice(0, COVER_COUNT),
            },
          }),
          items: [],
          podcasts: rows.map((row) => ({ podcast: serializePodcast(row.podcast) })),
        },
      });
    }

    const rows = await app.db
      .select({ episode: episodes, podcast: podcasts })
      .from(playlistItems)
      .innerJoin(episodes, eq(episodes.id, playlistItems.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
      .where(eq(playlistItems.playlistId, id))
      .orderBy(asc(playlistItems.sortKey));

    return ok({
      playlist: {
        ...serializePlaylist(playlist, bannerVersion, {
          episodes: {
            total: rows.length,
            artworkUrls: rows
              .map((row) => row.episode.artworkUrl ?? row.podcast.artworkUrl)
              .filter((url): url is string => url !== null)
              .slice(0, COVER_COUNT),
          },
          podcasts: emptySide,
        }),
        items: rows.map((row) => ({
          episode: serializeEpisode(row.episode),
          podcastTitle: row.podcast.title,
          podcastArtworkUrl: row.podcast.artworkUrl,
          accentColor: row.podcast.accentColor,
        })),
        podcasts: [],
      },
    });
  });

  app.patch('/me/playlists/:id', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);
    const input = updatePlaylistInput.parse(request.body);

    if (Object.values(input).every((value) => value === undefined)) {
      throw badRequest('Nothing to change');
    }

    const before = await own(app, user.id, id);

    /**
     * Asking to show a banner that was never uploaded.
     *
     * Refused rather than quietly stored, because the alternative is a playlist
     * whose `bannerKind` says `image` and whose banner is a blank rectangle —
     * a state the client would then have to defend against on every render.
     */
    if (input.bannerKind === 'image') {
      const version = await bannerVersionOf(app, id);
      if (!version) throw badRequest('Upload a picture before switching to it');
    }

    const [row] = await app.db
      .update(playlists)
      .set({
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.color === undefined ? {} : { color: input.color }),
        ...(input.bannerKind === undefined ? {} : { bannerKind: input.bannerKind }),
        ...(input.bannerText === undefined ? {} : { bannerText: input.bannerText }),
        ...(input.backgroundColor === undefined
          ? {}
          : { backgroundColor: input.backgroundColor }),
        updatedAt: new Date(),
      })
      .where(and(eq(playlists.id, id), eq(playlists.userId, user.id)))
      .returning();

    if (!row) throw notFound('Playlist');

    const bannerVersion = await bannerVersionOf(app, id);
    // Counts are not re-read: nothing on this route touches contents, and the
    // client already holds them. `before` is here only to keep `kind` honest.
    void before;

    return ok({ playlist: serializePlaylist(row, bannerVersion, empty) });
  });

  app.delete('/me/playlists/:id', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);

    // No ownership check and no 404: deleting what is not yours deletes
    // nothing, and deleting what is already gone is the outcome that was asked
    // for. Both answer the same way, which also means this cannot be used to
    // discover whether a given id exists.
    await app.db
      .delete(playlists)
      .where(and(eq(playlists.id, id), eq(playlists.userId, user.id)));

    return ok({ deleted: true });
  });

  // ---------------------------------------------------------------- banner --

  /**
   * Upload a banner.
   *
   * The body is the raw image, not multipart. There is exactly one file and no
   * other fields, so a multipart envelope would be a parser dependency and a
   * boundary to negotiate in exchange for nothing — `fetch(url, {body: file})`
   * is already the whole client.
   *
   * Whatever arrives is decoded and re-encoded rather than stored as sent. That
   * is the security boundary as much as the size one: it strips EXIF (which
   * routinely carries the GPS coordinates of someone's home), and it guarantees
   * the stored bytes really are an image, because something that only *claimed*
   * to be a PNG does not survive being decoded and written back out.
   */
  app.post(
    '/me/playlists/:id/banner',
    { bodyLimit: PLAYLIST_IMAGE_MAX_BYTES },
    async (request) => {
      const user = requireUser(request);
      const { id } = uuidParam.parse(request.params);

      await own(app, user.id, id);

      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw badRequest('Send the image itself as the request body');
      }

      let encoded: Buffer;
      try {
        encoded = await sharp(body)
          // `cover` rather than `contain`: a banner is a crop, and letterboxing
          // someone's photo into a coloured box is not what they asked for.
          .resize(PLAYLIST_IMAGE_WIDTH, PLAYLIST_IMAGE_HEIGHT, {
            fit: 'cover',
            position: 'attention',
            // Never scale a small picture up to the bound. A 400px-wide image
            // enlarged fourfold is a blurry banner; left alone it is a sharp
            // one the browser stretches, which at least starts from real pixels.
            withoutEnlargement: true,
          })
          .webp({ quality: 82 })
          .toBuffer();
      } catch (cause) {
        // Sharp throws on anything it cannot decode, which is the check — see
        // the note above about what re-encoding is really for.
        throw new AppError('bad_request', 'That file could not be read as an image', { cause });
      }

      const meta = await sharp(encoded).metadata();

      await app.db
        .insert(playlistBanners)
        .values({
          playlistId: id,
          contentType: 'image/webp',
          width: meta.width ?? PLAYLIST_IMAGE_WIDTH,
          height: meta.height ?? PLAYLIST_IMAGE_HEIGHT,
          bytes: encoded,
        })
        .onConflictDoUpdate({
          target: playlistBanners.playlistId,
          set: {
            contentType: 'image/webp',
            width: meta.width ?? PLAYLIST_IMAGE_WIDTH,
            height: meta.height ?? PLAYLIST_IMAGE_HEIGHT,
            bytes: encoded,
            // A fresh version, which is what makes the new picture reachable at
            // a URL nothing has cached. See the column.
            version: sql`gen_random_uuid()`,
            updatedAt: new Date(),
          },
        });

      // Uploading a picture is asking to see it. Making someone upload and then
      // separately switch to it would be two steps for one intention.
      const [row] = await app.db
        .update(playlists)
        .set({ bannerKind: 'image', updatedAt: new Date() })
        .where(and(eq(playlists.id, id), eq(playlists.userId, user.id)))
        .returning();

      if (!row) throw notFound('Playlist');

      return ok({ playlist: serializePlaylist(row, await bannerVersionOf(app, id), empty) });
    },
  );

  /** Drop the picture and fall back to the colour. */
  app.delete('/me/playlists/:id/banner', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);

    await own(app, user.id, id);

    await app.db.delete(playlistBanners).where(eq(playlistBanners.playlistId, id));

    const [row] = await app.db
      .update(playlists)
      .set({ bannerKind: 'color', updatedAt: new Date() })
      .where(and(eq(playlists.id, id), eq(playlists.userId, user.id)))
      .returning();

    if (!row) throw notFound('Playlist');

    return ok({ playlist: serializePlaylist(row, null, empty) });
  });

  /**
   * Serve a banner.
   *
   * Unauthenticated, and deliberately so — the random `version` in the path is
   * the credential. This is a capability URL: 122 bits of entropy that only the
   * playlist's owner is ever told, re-rolled every time the picture is replaced.
   *
   * The alternative was a session-authenticated route, which sounds stricter
   * and is worse here. An `<img>` pointed at a cross-origin API only sends
   * cookies with `crossOrigin="use-credentials"`, and when that negotiation
   * fails the image does not degrade — it does not render at all. Trading a
   * reliable render for a guess nobody can make is the right side of that.
   *
   * What it costs, stated plainly: anyone given the URL can fetch the picture
   * without signing in. For a decorative banner the owner chose, that is
   * acceptable; it would not be for anything private, and nothing private
   * should ever be served this way.
   */
  app.get('/playlists/:id/banner/:version', async (request, reply) => {
    const { id, version } = bannerParams.parse(request.params);

    const [row] = await app.db
      .select({
        bytes: playlistBanners.bytes,
        contentType: playlistBanners.contentType,
      })
      .from(playlistBanners)
      .where(and(eq(playlistBanners.playlistId, id), eq(playlistBanners.version, version)))
      .limit(1);

    if (!row) throw notFound('Banner');

    // Immutable is true by construction: replacing the picture mints a new
    // version, so this exact URL can never answer with different bytes.
    void reply
      .header('content-type', row.contentType)
      .header('cache-control', 'private, max-age=31536000, immutable')
      // The bytes are an image and nothing else. Without this a browser is
      // free to sniff, and sniffing is how an upload becomes a script.
      .header('x-content-type-options', 'nosniff')
      /*
        Helmet defaults every response to `same-origin`, which is right for
        every other route here and wrong for this one: the web app is served
        from a different origin than this API, so the default made the browser
        refuse the image after fetching it — `ERR_BLOCKED_BY_RESPONSE`, with a
        200 in the network panel and an empty banner on screen.

        `cross-origin` is safe precisely because this route is already
        unauthenticated: CORP protects responses whose secrecy depends on the
        caller's cookies, and this one's does not depend on cookies at all.
      */
      .header('cross-origin-resource-policy', 'cross-origin');

    return reply.send(row.bytes);
  });

  // ----------------------------------------------------------------- items --

  app.post('/me/playlists/:id/items', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);
    const input = addToPlaylistInput.parse(request.body);

    const playlist = await own(app, user.id, id);
    if (playlist.kind !== 'episode') throw wrongKind(playlist.kind);

    const [episode] = await app.db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.id, input.episodeId))
      .limit(1);
    if (!episode) throw notFound('Episode');

    await roomFor(app, 'items', id);

    const sortKey = await placeAt(app, {
      table: 'items',
      playlistId: id,
      toStart: input.position === 'start',
    });

    await app.db
      .insert(playlistItems)
      .values({ playlistId: id, episodeId: input.episodeId, sortKey })
      // Already in the playlist is success, not a conflict — the control is
      // optimistic, and a double tap must not roll back on the client.
      .onConflictDoNothing({
        target: [playlistItems.playlistId, playlistItems.episodeId],
      });

    await touch(app, id);

    return ok({ added: true });
  });

  app.delete('/me/playlists/:id/items/:episodeId', async (request) => {
    const user = requireUser(request);
    const { id, episodeId } = itemParams.parse(request.params);

    await own(app, user.id, id);

    await app.db
      .delete(playlistItems)
      .where(and(eq(playlistItems.playlistId, id), eq(playlistItems.episodeId, episodeId)));

    await touch(app, id);

    return ok({ removed: true });
  });

  /**
   * Reorder.
   *
   * Takes the full intended order and rewrites keys, which makes the operation
   * idempotent and immune to two devices disagreeing about what the list looked
   * like. Ids that are not in this playlist are dropped rather than rejected —
   * an order computed against a slightly stale list is the normal case, not an
   * error.
   */
  app.put('/me/playlists/:id/order', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);
    const input = reorderPlaylistInput.parse(request.body);

    await own(app, user.id, id);

    const owned = await app.db
      .select({ episodeId: playlistItems.episodeId })
      .from(playlistItems)
      .where(
        and(
          eq(playlistItems.playlistId, id),
          inArray(playlistItems.episodeId, input.episodeIds),
        ),
      );

    const ownedIds = new Set(owned.map((row) => row.episodeId));
    const ordered = input.episodeIds.filter((episodeId) => ownedIds.has(episodeId));

    if (ordered.length === 0) throw badRequest('None of those episodes are in this playlist');

    let previous: string | null = null;
    for (const episodeId of ordered) {
      const sortKey: string = generateKey(previous, null);
      await app.db
        .update(playlistItems)
        .set({ sortKey })
        .where(and(eq(playlistItems.playlistId, id), eq(playlistItems.episodeId, episodeId)));
      previous = sortKey;
    }

    await touch(app, id);

    return ok({ reordered: ordered.length });
  });

  // -------------------------------------------------------------- podcasts --

  app.post('/me/playlists/:id/podcasts', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);
    const input = addPodcastToPlaylistInput.parse(request.body);

    const playlist = await own(app, user.id, id);
    // The refusal this whole `kind` distinction exists for. The client turns
    // this into an offer to make a show playlist instead — see `wrongKind`.
    if (playlist.kind !== 'podcast') throw wrongKind(playlist.kind);

    const [podcast] = await app.db
      .select({ id: podcasts.id })
      .from(podcasts)
      .where(eq(podcasts.id, input.podcastId))
      .limit(1);
    if (!podcast) throw notFound('Podcast');

    await roomFor(app, 'podcasts', id);

    const sortKey = await placeAt(app, {
      table: 'podcasts',
      playlistId: id,
      toStart: input.position === 'start',
    });

    await app.db
      .insert(playlistPodcasts)
      .values({ playlistId: id, podcastId: input.podcastId, sortKey })
      .onConflictDoNothing({
        target: [playlistPodcasts.playlistId, playlistPodcasts.podcastId],
      });

    await touch(app, id);

    return ok({ added: true });
  });

  app.delete('/me/playlists/:id/podcasts/:podcastId', async (request) => {
    const user = requireUser(request);
    const { id, podcastId } = podcastItemParams.parse(request.params);

    await own(app, user.id, id);

    await app.db
      .delete(playlistPodcasts)
      .where(
        and(eq(playlistPodcasts.playlistId, id), eq(playlistPodcasts.podcastId, podcastId)),
      );

    await touch(app, id);

    return ok({ removed: true });
  });

  app.put('/me/playlists/:id/podcasts/order', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);
    const input = reorderPlaylistPodcastsInput.parse(request.body);

    await own(app, user.id, id);

    const owned = await app.db
      .select({ podcastId: playlistPodcasts.podcastId })
      .from(playlistPodcasts)
      .where(
        and(
          eq(playlistPodcasts.playlistId, id),
          inArray(playlistPodcasts.podcastId, input.podcastIds),
        ),
      );

    const ownedIds = new Set(owned.map((row) => row.podcastId));
    const ordered = input.podcastIds.filter((podcastId) => ownedIds.has(podcastId));

    if (ordered.length === 0) throw badRequest('None of those shows are in this playlist');

    let previous: string | null = null;
    for (const podcastId of ordered) {
      const sortKey: string = generateKey(previous, null);
      await app.db
        .update(playlistPodcasts)
        .set({ sortKey })
        .where(
          and(eq(playlistPodcasts.playlistId, id), eq(playlistPodcasts.podcastId, podcastId)),
        );
      previous = sortKey;
    }

    await touch(app, id);

    return ok({ reordered: ordered.length });
  });

  /**
   * Which of this user's playlists already hold a given episode.
   *
   * One request for the whole answer, so an "add to playlist" sheet can show
   * ticks the moment it opens rather than firing a membership check per row.
   */
  app.get('/me/playlists/containing/:id', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);

    const rows = await app.db
      .select({ playlistId: playlistItems.playlistId })
      .from(playlistItems)
      .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
      .where(and(eq(playlistItems.episodeId, id), eq(playlists.userId, user.id)));

    return ok({ playlistIds: rows.map((row) => row.playlistId) });
  });

  /** The same question for a whole show. */
  app.get('/me/playlists/containing-podcast/:id', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);

    const rows = await app.db
      .select({ playlistId: playlistPodcasts.playlistId })
      .from(playlistPodcasts)
      .innerJoin(playlists, eq(playlists.id, playlistPodcasts.playlistId))
      .where(and(eq(playlistPodcasts.podcastId, id), eq(playlists.userId, user.id)));

    return ok({ playlistIds: rows.map((row) => row.playlistId) });
  });
}

/**
 * Teach Fastify to hand image uploads over as a Buffer.
 *
 * Registered here rather than in `server.ts` because this is the only route
 * that accepts an image, and a parser declared next to its one consumer is a
 * parser nobody has to go looking for. The per-route `bodyLimit` is what caps
 * the size; this only decides the shape.
 */
function registerImageParser(app: FastifyInstance): void {
  for (const type of PLAYLIST_IMAGE_TYPES) {
    app.addContentTypeParser(type, { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });
  }
}

/**
 * Refuse a playlist that is already at its ceiling.
 *
 * A guard rather than a product limit — nobody curating podcasts reaches five
 * hundred — but the reorder route rewrites every key it is given, so the list
 * it can be handed has to have a top. Checked before the insert rather than
 * enforced by a constraint because the answer a person needs is a sentence.
 */
async function roomFor(
  app: FastifyInstance,
  table: 'items' | 'podcasts',
  playlistId: string,
): Promise<void> {
  const from = table === 'items' ? playlistItems : playlistPodcasts;
  const listId = table === 'items' ? playlistItems.playlistId : playlistPodcasts.playlistId;

  const [existing] = await app.db
    .select({ total: count() })
    .from(from)
    .where(eq(listId, playlistId));

  if ((existing?.total ?? 0) >= PLAYLIST_ITEMS_MAX) {
    throw badRequest(
      table === 'items'
        ? `A playlist holds up to ${PLAYLIST_ITEMS_MAX} episodes`
        : `A playlist holds up to ${PLAYLIST_ITEMS_MAX} shows`,
    );
  }
}

/**
 * The key for a new item at one end of a playlist.
 *
 * Only the neighbouring key is read, never the whole list — that is the point
 * of fractional indexing, and it is why adding to a five-hundred-episode
 * playlist costs the same as adding to an empty one.
 */
async function placeAt(
  app: FastifyInstance,
  options: { table: 'items' | 'podcasts'; playlistId: string; toStart: boolean },
): Promise<string> {
  const { table, playlistId, toStart } = options;

  const sortKey = table === 'items' ? playlistItems.sortKey : playlistPodcasts.sortKey;
  const listId = table === 'items' ? playlistItems.playlistId : playlistPodcasts.playlistId;
  const from = table === 'items' ? playlistItems : playlistPodcasts;

  const [neighbour] = await app.db
    .select({ sortKey })
    .from(from)
    .where(eq(listId, playlistId))
    .orderBy(toStart ? asc(sortKey) : desc(sortKey))
    .limit(1);

  return toStart
    ? generateKey(null, neighbour?.sortKey ?? null)
    : generateKey(neighbour?.sortKey ?? null, null);
}

/**
 * Prove the playlist is this user's, or 404.
 *
 * `not_found` rather than `forbidden` on purpose: a distinct "that exists but
 * is not yours" turns the id space into an oracle anyone can enumerate.
 */
async function own(
  app: FastifyInstance,
  userId: string,
  playlistId: string,
): Promise<typeof playlists.$inferSelect> {
  const [row] = await app.db
    .select()
    .from(playlists)
    .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))
    .limit(1);

  if (!row) throw notFound('Playlist');
  return row;
}

/** The banner's cache-busting version, or null when there is no banner. */
async function bannerVersionOf(app: FastifyInstance, playlistId: string): Promise<string | null> {
  const [row] = await app.db
    .select({ version: playlistBanners.version })
    .from(playlistBanners)
    .where(eq(playlistBanners.playlistId, playlistId))
    .limit(1);

  return row?.version ?? null;
}

/**
 * Mark a playlist as touched.
 *
 * The list is sorted by this, and "recently used" is what someone means when
 * they go looking — which is the playlist they just added to, not the one they
 * last renamed. So contents count as a change, not only the title.
 */
async function touch(app: FastifyInstance, playlistId: string): Promise<void> {
  await app.db
    .update(playlists)
    .set({ updatedAt: new Date() })
    .where(eq(playlists.id, playlistId));
}

type Side = { total: number; artworkUrls: string[] };
const emptySide: Side = { total: 0, artworkUrls: [] };
/** For the routes that answer with a playlist whose contents they did not read. */
const empty = { episodes: emptySide, podcasts: emptySide };

function serializePlaylist(
  row: typeof playlists.$inferSelect,
  bannerVersion: string | null,
  counts: { episodes: Side; podcasts: Side },
): Playlist {
  // One `itemCount` rather than two, chosen by `kind`. A caller holding both
  // would be re-deriving `kind` to know which one meant anything.
  const side = row.kind === 'podcast' ? counts.podcasts : counts.episodes;

  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    itemCount: side.total,
    banner: {
      // Falls back to the colour when the row says `image` and no picture is
      // there — which the routes above prevent, but a database is edited by
      // more than this file over a long enough life.
      kind: row.bannerKind === 'image' && bannerVersion ? 'image' : 'color',
      color: row.color as PlaylistColor,
      imageUrl: bannerVersion ? `/playlists/${row.id}/banner/${bannerVersion}` : null,
      text: row.bannerText,
    },
    backgroundColor: (row.backgroundColor as PlaylistColor | null) ?? null,
    artworkUrls: side.artworkUrls,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
