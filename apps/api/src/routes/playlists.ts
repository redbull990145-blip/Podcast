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
 */

import { generateKey } from '@cue/core';
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  episodes,
  paginate,
  playlistItems,
  playlists,
  podcasts,
} from '@cue/db';
import type { Playlist } from '@cue/types';
import {
  addToPlaylistInput,
  createPlaylistInput,
  PLAYLIST_ITEMS_MAX,
  PLAYLIST_MAX,
  paginationQuery,
  reorderPlaylistInput,
  updatePlaylistInput,
  uuidParam,
} from '@cue/validation';
import { and, asc, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/plugin.ts';
import { serializeEpisode } from '../catalog/serialize.ts';
import { badRequest, notFound, ok } from '../errors.ts';

/**
 * How many covers a tile stacks.
 *
 * Four, because that is what a 2×2 stack holds and what reads as "a collection"
 * rather than "one episode's artwork with a border".
 */
const COVER_COUNT = 4;

const itemParams = z.object({ id: z.uuid(), episodeId: z.uuid() });

export function playlistRoutes(app: FastifyInstance): void {
  /**
   * Contents summary: how many episodes, and the first few covers.
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

  /** This user's playlists, most recently touched first. */
  app.get('/me/playlists', async (request) => {
    const user = requireUser(request);
    const query = paginationQuery.parse(request.query);
    const limit = clampLimit(query.limit);

    const cursor = decodeCursor(query.cursor);
    const keyset = cursor
      ? or(
          lt(playlists.updatedAt, new Date(cursor.sortValue)),
          and(eq(playlists.updatedAt, new Date(cursor.sortValue)), lt(playlists.id, cursor.id)),
        )
      : undefined;

    const scope = eq(playlists.userId, user.id);

    const rows = await app.db
      .select({
        playlist: playlists,
        episodeCount: contents.total,
        artworkUrls: contents.artworkUrls,
      })
      .from(playlists)
      // Left, not inner: an empty playlist is a playlist, and an inner join
      // would drop every one of them from the list that exists to show them.
      .leftJoin(contents, eq(contents.playlistId, playlists.id))
      .where(keyset ? and(scope, keyset) : scope)
      .orderBy(desc(playlists.updatedAt), desc(playlists.id))
      .limit(limit + 1);

    const page = paginate(rows, limit, (row) =>
      encodeCursor(row.playlist.updatedAt, row.playlist.id),
    );

    return ok({
      items: page.items.map((row) =>
        serializePlaylist(row.playlist, row.episodeCount ?? 0, row.artworkUrls ?? []),
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
        title: input.title,
        description: input.description ?? null,
      })
      .returning();

    if (!row) throw badRequest('The playlist could not be created');

    void reply.status(201);
    return ok({ playlist: serializePlaylist(row, 0, []) });
  });

  /** One playlist, with its contents in order. */
  app.get('/me/playlists/:id', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);

    const playlist = await own(app, user.id, id);

    const rows = await app.db
      .select({ episode: episodes, podcast: podcasts })
      .from(playlistItems)
      .innerJoin(episodes, eq(episodes.id, playlistItems.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
      .where(eq(playlistItems.playlistId, id))
      .orderBy(asc(playlistItems.sortKey));

    return ok({
      playlist: {
        ...serializePlaylist(
          playlist,
          rows.length,
          rows
            .map((row) => row.episode.artworkUrl ?? row.podcast.artworkUrl)
            .filter((url): url is string => url !== null)
            .slice(0, COVER_COUNT),
        ),
        items: rows.map((row) => ({
          episode: serializeEpisode(row.episode),
          podcastTitle: row.podcast.title,
          podcastArtworkUrl: row.podcast.artworkUrl,
          accentColor: row.podcast.accentColor,
        })),
      },
    });
  });

  app.patch('/me/playlists/:id', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);
    const input = updatePlaylistInput.parse(request.body);

    if (input.title === undefined && input.description === undefined) {
      throw badRequest('Nothing to change');
    }

    await own(app, user.id, id);

    const [row] = await app.db
      .update(playlists)
      .set({
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        updatedAt: new Date(),
      })
      .where(and(eq(playlists.id, id), eq(playlists.userId, user.id)))
      .returning();

    if (!row) throw notFound('Playlist');

    return ok({ playlist: serializePlaylist(row, 0, []) });
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

  // ----------------------------------------------------------------- items --

  app.post('/me/playlists/:id/items', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);
    const input = addToPlaylistInput.parse(request.body);

    await own(app, user.id, id);

    const [episode] = await app.db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.id, input.episodeId))
      .limit(1);
    if (!episode) throw notFound('Episode');

    const [existing] = await app.db
      .select({ total: count() })
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, id));

    if ((existing?.total ?? 0) >= PLAYLIST_ITEMS_MAX) {
      throw badRequest(`A playlist holds up to ${PLAYLIST_ITEMS_MAX} episodes`);
    }

    const toStart = input.position === 'start';

    // Only the neighbouring key is needed to place the new item, never the
    // whole list — that is the point of fractional indexing.
    const [neighbour] = await app.db
      .select({ sortKey: playlistItems.sortKey })
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, id))
      .orderBy(toStart ? asc(playlistItems.sortKey) : desc(playlistItems.sortKey))
      .limit(1);

    const sortKey = toStart
      ? generateKey(null, neighbour?.sortKey ?? null)
      : generateKey(neighbour?.sortKey ?? null, null);

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

function serializePlaylist(
  row: typeof playlists.$inferSelect,
  episodes: number,
  artworkUrls: string[],
): Playlist {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    episodeCount: episodes,
    artworkUrls,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
