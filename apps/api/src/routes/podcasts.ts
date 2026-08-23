/**
 * Catalog endpoints.
 *
 * Everything here is public and cacheable — no session, no user data. That is
 * what lets these responses be cached aggressively at every layer.
 */

import { clampLimit, decodeCursor, encodeCursor, paginate, podcasts, episodes, categories, podcastCategories } from '@cue/db';
import type { PodcastSearchResult } from '@cue/types';
import {
  catalogueQuery,
  feedUrlInput,
  numberedPageQuery,
  paginationQuery,
  searchQuery,
  uuidParam,
} from '@cue/validation';
import { and, count, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { PodcastIndexFeed } from '../catalog/podcastindex.ts';
import { serializeEpisode, serializePodcast } from '../catalog/serialize.ts';
import { extractArtworkColor } from '../feed/artwork-color.ts';
import { ingestFeed } from '../feed/ingest.ts';
import { normalizeFeedUrl } from '../feed/url-guard.ts';
import { badRequest, notFound, ok } from '../errors.ts';
import { catalogueRateLimit, rateLimit } from '../rate-limit.ts';

const SEARCH_CANDIDATES = 50;

/**
 * A directory hit on our wire.
 *
 * Deliberately not the `Podcast` shape: these are not in our database yet and
 * have no id here. Adding one is what ingests it and gives it one — which is
 * why `feedUrl` is the field that matters, and why search and trending have to
 * agree on its name.
 */
function serializeDirectoryFeed(feed: PodcastIndexFeed): PodcastSearchResult {
  return {
    feedUrl: feed.url,
    title: feed.title,
    author: feed.author,
    description: feed.description,
    artworkUrl: feed.artworkUrl,
    language: feed.language,
    categories: feed.categories,
    explicit: feed.explicit,
    episodeCount: feed.episodeCount,
    lastPublishedAt: feed.lastPublishedAt,
  };
}

/**
 * The catalogue as a directory, for when the real directory is unreachable.
 *
 * Returns the same `PodcastSearchResult` shape rather than `Podcast`, so the
 * client renders one list and never learns where a row came from. These rows
 * *do* have ids here — they are already ingested — but the field that matters
 * to the caller is `feedUrl`, because adding by feed URL is idempotent: a show
 * already in the table resolves to the row it already has.
 *
 * A plain `ILIKE` over title and author. It is a fallback on a table of at most
 * a few thousand rows, and reaching for full-text ranking here would be
 * building a second search engine to cover the minutes the first one is down.
 */
async function searchCatalogue(
  app: FastifyInstance,
  term: string,
  limit: number,
): Promise<PodcastSearchResult[]> {
  // Escaped, so a listener searching for "100%" gets that rather than a
  // wildcard — `%` and `_` are operators inside LIKE.
  const pattern = `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

  const rows = await app.db
    .select({
      feedUrl: podcasts.feedUrl,
      title: podcasts.title,
      author: podcasts.author,
      description: podcasts.description,
      artworkUrl: podcasts.artworkUrl,
      language: podcasts.language,
      explicit: podcasts.explicit,
      lastPublishedAt: podcasts.lastPublishedAt,
    })
    .from(podcasts)
    .where(
      or(
        sql`${podcasts.title} ILIKE ${pattern}`,
        sql`${podcasts.author} ILIKE ${pattern}`,
      ),
    )
    .orderBy(desc(podcasts.lastPublishedAt))
    .limit(limit);

  return rows.map((row) => ({
    feedUrl: row.feedUrl,
    title: row.title,
    author: row.author,
    description: row.description,
    artworkUrl: row.artworkUrl,
    language: row.language,
    // Not carried on the row in a form worth reconstructing here, and the
    // fallback list is short enough that category chips add nothing.
    categories: [],
    explicit: row.explicit,
    episodeCount: null,
    lastPublishedAt: row.lastPublishedAt?.toISOString() ?? null,
  }));
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function searchTokens(value: string): string[] {
  return normalizeSearchText(value)
    .split(' ')
    .filter((token) => token.length > 0);
}

function boundedDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let index = 1; index <= a.length; index += 1) {
    const current = [index];
    let rowBest = current[0]!;

    for (let other = 1; other <= b.length; other += 1) {
      const cost = a[index - 1] === b[other - 1] ? 0 : 1;
      const value = Math.min(
        current[other - 1]! + 1,
        previous[other]! + 1,
        previous[other - 1]! + cost,
      );
      current[other] = value;
      rowBest = Math.min(rowBest, value);
    }

    if (rowBest > max) return max + 1;
    previous = current;
  }

  return previous[b.length]!;
}

function fuzzyTokenScore(queryTokens: string[], candidateTokens: string[]): number {
  let score = 0;

  for (const queryToken of queryTokens) {
    if (queryToken.length < 4) continue;
    const maxDistance = queryToken.length <= 5 ? 1 : 2;
    const matched = candidateTokens.some((candidate) => {
      if (candidate.length < 4) return false;
      return boundedDistance(queryToken, candidate, maxDistance) <= maxDistance;
    });

    if (matched) score += 3;
  }

  return score;
}

function scoreFeed(feed: PodcastIndexFeed, rawQuery: string, language?: string): number {
  const query = normalizeSearchText(rawQuery);
  const title = normalizeSearchText(feed.title);
  const author = normalizeSearchText(feed.author);
  const categoriesText = normalizeSearchText(feed.categories.join(' '));
  const description = normalizeSearchText(feed.description);
  const queryTokens = searchTokens(rawQuery);
  const candidateTokens = searchTokens(
    [feed.title, feed.author, feed.categories.join(' '), feed.description]
      .filter(Boolean)
      .join(' '),
  );

  let score = 0;

  if (title === query) score += 120;
  else if (title.startsWith(query)) score += 95;
  else if (title.includes(query)) score += 70;

  if (author === query) score += 65;
  else if (author.startsWith(query)) score += 48;
  else if (author.includes(query)) score += 32;

  if (categoriesText.split(' ').includes(query)) score += 36;
  else if (categoriesText.includes(query)) score += 24;

  if (description.includes(query)) score += 12;

  for (const token of queryTokens) {
    if (token.length < 2) continue;
    if (title.split(' ').some((candidate) => candidate.startsWith(token))) score += 12;
    if (author.split(' ').some((candidate) => candidate.startsWith(token))) score += 8;
    if (categoriesText.split(' ').some((candidate) => candidate.startsWith(token))) score += 6;
    if (description.split(' ').some((candidate) => candidate.startsWith(token))) score += 2;
  }

  score += fuzzyTokenScore(queryTokens, candidateTokens);

  if (language && feed.language?.toLowerCase().startsWith(language.toLowerCase())) score += 8;
  if (feed.episodeCount !== null) score += Math.min(10, Math.log10(feed.episodeCount + 1) * 3);
  if (feed.lastPublishedAt) score += 3;
  if (feed.artworkUrl) score += 1;

  return score;
}

function normalizedFeedKey(feedUrl: string): string {
  try {
    const url = new URL(feedUrl);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    return url.href.replace(/\/$/, '');
  } catch {
    return feedUrl.trim().toLowerCase();
  }
}

function rankSearchResults(
  feeds: PodcastIndexFeed[],
  query: string,
  options: { language?: string; limit: number },
): PodcastIndexFeed[] {
  const seen = new Set<string>();
  const ranked = feeds
    .filter((feed) => {
      const key = normalizedFeedKey(feed.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((feed, index) => ({
      feed,
      index,
      score: scoreFeed(feed, query, options.language),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const strong = ranked.filter((entry) => entry.score >= 20);
  const usable = strong.length >= Math.min(options.limit, 6) ? strong : ranked;

  return usable.slice(0, options.limit).map((entry) => entry.feed);
}

export function podcastRoutes(app: FastifyInstance): void {
  /**
   * The guard on every public catalogue read below.
   *
   * Built once here rather than per route so all five share one decision about
   * whether limiting is on at all — `catalogueRateLimit` returns undefined when
   * no internal token is configured, and Fastify treats an undefined
   * `preHandler` as absent, which is exactly the fail-open behaviour that case
   * wants.
   */
  const catalogue = catalogueRateLimit(app, app.config.internalToken);

  /**
   * Search. Hits PodcastIndex rather than our own table, because the catalog
   * is only what users have already added — searching it would mean an empty
   * app for the first person to look for anything.
   */
  app.get('/podcasts/search', { preHandler: rateLimit(app, 'search') }, async (request) => {
    const query = searchQuery.parse(request.query);
    const limit = query.limit ?? 25;

    let feeds: PodcastIndexFeed[];
    try {
      feeds = await app.podcastIndex.search(query.q, {
        ...(query.language ? { language: query.language } : {}),
        limit: Math.max(limit, SEARCH_CANDIDATES),
      });
    } catch (error) {
      /*
        The directory is down. Answer with what we already have rather than
        with a 502.

        Searching our own table is the wrong *primary* behaviour — it would
        mean an empty app for the first person to look for anything, which is
        why this endpoint goes upstream at all. As a fallback it is strictly
        better than the alternative: the shows in this table are the ones
        somebody here already cared enough to add, and a short list of them
        beats "Server returned an error" over an empty screen.

        Logged at warn rather than swallowed. A listener seeing degraded
        results should not be the only trace that the directory is failing.
      */
      request.log.warn({ err: error, q: query.q }, 'directory search failed; serving catalogue');

      return ok({
        results: await searchCatalogue(app, query.q, limit),
        /**
         * Said out loud, so the client can tell a thin answer from a complete
         * one. Without it, three local results and thirty directory results
         * are indistinguishable — and the honest UI for the first is "search
         * is having trouble", not silence.
         */
        degraded: true,
      });
    }

    return ok({
      results: rankSearchResults(feeds, query.q, {
        ...(query.language ? { language: query.language } : {}),
        limit,
      }).map(serializeDirectoryFeed),
    });
  });

  app.get('/podcasts/trending', { preHandler: rateLimit(app, 'search') }, async (request) => {
    const query = searchQuery.partial({ q: true }).parse(request.query);

    const feeds = await app.podcastIndex.trending({
      ...(query.language ? { language: query.language } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    });

    // The same serializer as search, not the raw feed. These two feed one list
    // component, and the upstream shape calls the subscribe target `url` while
    // ours calls it `feedUrl` — so returning it unmapped handed the client a
    // result it could render and could not act on.
    return ok({ results: feeds.map(serializeDirectoryFeed) });
  });

  /**
   * Add a feed by URL, ingesting it synchronously.
   *
   * Synchronous on purpose: the user is waiting to see the show they just
   * pasted, and a background job would mean staring at an empty page while a
   * queue drains. The SSRF guard and size caps are what make it safe to do a
   * user-triggered fetch inline.
   */
  app.post('/podcasts', { preHandler: rateLimit(app, 'expensive') }, async (request) => {
    const body = feedUrlInput.parse(request.body);

    const normalized = normalizeFeedUrl(body.feedUrl);
    if (!normalized) throw badRequest('That does not look like a URL', { feedUrl: 'Invalid URL' });

    // Marked as coming from the directory, which is what makes it possible
    // later to tell a show the operator curated from one a visitor typed in.
    const result = await ingestFeed(app.db, normalized.href, { source: 'directory' });

    if (result.status === 'gone') {
      throw badRequest('That feed no longer exists', { feedUrl: result.detail });
    }
    if (result.status === 'failed') {
      throw badRequest('Could not read that feed', { feedUrl: result.detail });
    }

    const [row] = await app.db
      .select()
      .from(podcasts)
      .where(eq(podcasts.id, result.podcastId))
      .limit(1);

    if (!row) throw notFound('Podcast');

    return ok({ podcast: serializePodcast(row, await categoriesFor(app, row.id)) });
  });

  /**
   * The catalog: every show anyone has added, most recently active first.
   *
   * Ordered by `lastPublishedAt` rather than when it was added, because a show
   * that stopped publishing in 2019 is less useful at the top of a list than
   * one that released this morning. Nulls sort last — a feed we have not read
   * yet has no claim on the top of the page.
   */
  app.get('/podcasts', { preHandler: catalogue }, async (request) => {
    const query = catalogueQuery.parse(request.query);
    const limit = clampLimit(query.limit);

    const cursor = decodeCursor(query.cursor);
    const keyset = cursor
      ? or(
          lt(podcasts.lastPublishedAt, new Date(cursor.sortValue)),
          and(
            eq(podcasts.lastPublishedAt, new Date(cursor.sortValue)),
            lt(podcasts.id, cursor.id),
          ),
        )
      : undefined;

    /**
     * Narrowed by an `EXISTS`, not a join.
     *
     * A show can carry several categories, and joining through the link table
     * would return it once per matching row — which is invisible while
     * filtering on one category and becomes duplicate covers the moment anyone
     * asks for two. `EXISTS` also lets the planner stop at the first hit
     * instead of materialising every pairing.
     */
    const inCategory = query.category
      ? sql`EXISTS (
          SELECT 1 FROM ${podcastCategories}
          JOIN ${categories} ON ${categories.id} = ${podcastCategories.categoryId}
          WHERE ${podcastCategories.podcastId} = ${podcasts.id}
            AND ${categories.slug} = ${query.category}
        )`
      : undefined;

    const rows = await app.db
      .select()
      .from(podcasts)
      .where(and(keyset, inCategory))
      .orderBy(sql`${podcasts.lastPublishedAt} DESC NULLS LAST`, desc(podcasts.id))
      .limit(limit + 1);

    const page = paginate(rows, limit, (row) =>
      encodeCursor(row.lastPublishedAt ?? new Date(0), row.id),
    );

    return ok({
      items: page.items.map((row) => serializePodcast(row)),
      nextCursor: page.nextCursor,
    });
  });

  /**
   * The catalogue's categories, with a count and a colour each.
   *
   * One query, not one per category. The obvious shape — list the categories,
   * then count each one — is a dozen round trips to render a screen of tiles,
   * and it gets worse as the catalogue grows. Grouping does it in a single
   * pass over the index that exists for exactly this direction
   * (`podcast_categories_category_idx`).
   *
   * `MIN(accent_color)` is doing something slightly sneaky and worth naming: it
   * is not the minimum of anything meaningful, it is *any non-null one*, which
   * is what an aggregate has to be when the value is only there to be
   * representative. Picking deterministically also means the tile does not
   * change colour between two renders of the same data.
   *
   * Categories with no shows never appear, because the join produces no row
   * for them — a browse screen offering an empty shelf is worse than a shorter
   * one.
   */
  app.get('/categories', { preHandler: catalogue }, async () => {
    const rows = await app.db
      .select({
        slug: categories.slug,
        name: categories.name,
        count: sql<number>`count(*)::int`,
        accentColor: sql<string | null>`min(${podcasts.accentColor})`,
      })
      .from(podcastCategories)
      .innerJoin(categories, eq(categories.id, podcastCategories.categoryId))
      .innerJoin(podcasts, eq(podcasts.id, podcastCategories.podcastId))
      .groupBy(categories.slug, categories.name)
      .orderBy(sql`count(*) DESC`, categories.name);

    return ok({ items: rows });
  });

  app.get('/podcasts/:id', { preHandler: catalogue }, async (request) => {
    const { id } = uuidParam.parse(request.params);

    const [row] = await app.db.select().from(podcasts).where(eq(podcasts.id, id)).limit(1);
    if (!row) throw notFound('Podcast');

    return ok({ podcast: serializePodcast(row, await categoriesFor(app, row.id)) });
  });

  /**
   * A show's episodes, newest first.
   *
   * The keyset predicate `(published_at, id) < (cursor)` reads straight down
   * `episodes_podcast_published_idx`, so page 50 of a 900-episode show costs
   * the same as page 1.
   */
  /**
   * A show's episodes, either continued or jumped to.
   *
   * Two pagination modes on one route, because the two callers want genuinely
   * different things and neither is served well by the other's shape.
   *
   * **Keyset** — `?cursor=` — is the default and stays the default. It is cheap
   * at any depth and never skips or repeats a row when a publisher posts
   * mid-scroll, which is what an infinite list needs.
   *
   * **Offset** — `?page=` — exists because a podcast archive is one of the few
   * lists in this product people navigate deliberately rather than by
   * scrolling: 2,947 episodes of a daily show is eleven years, and "somewhere
   * near the start" is a real destination that a cursor cannot express, since
   * the cursor for page 40 only exists once pages 1 to 39 have been read.
   *
   * The offset path pays for that with a `COUNT(*)` — a pager cannot render
   * without knowing how many pages there are — so it runs only when asked for.
   */
/**
 * Which pagination mode the caller asked for.
 *
 * Presence of `page`, not a mode flag. A client that sends neither gets the
 * cheap keyset path, which is what every existing caller does and must keep
 * doing — adding an explicit `?mode=` would have meant changing all of them to
 * keep the behaviour they already had.
 */
function hasPageParam(query: unknown): boolean {
  return typeof query === 'object' && query !== null && 'page' in query;
}

  app.get('/podcasts/:id/episodes', { preHandler: catalogue }, async (request) => {
    const { id } = uuidParam.parse(request.params);
    const mine = eq(episodes.podcastId, id);
    const newestFirst = [desc(episodes.publishedAt), desc(episodes.id)] as const;

    if (hasPageParam(request.query)) {
      const query = numberedPageQuery.parse(request.query);
      const pageSize = clampLimit(query.limit);

      const [counted] = await app.db
        .select({ total: count() })
        .from(episodes)
        .where(mine);
      const total = counted?.total ?? 0;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));

      /*
        Clamped rather than 404'd or answered empty.

        `?page=900` on a show that has four is not an error a person can act on
        — it is a stale link, or a pager rendered against a count that has since
        changed because the publisher deleted a back catalogue. Answering with
        the last real page shows them something and leaves the pager honest;
        answering with nothing shows them a blank archive and no way back.
      */
      const page = Math.min(query.page ?? 1, pageCount);

      const rows = await app.db
        .select()
        .from(episodes)
        .where(mine)
        .orderBy(...newestFirst)
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return ok({
        items: rows.map(serializeEpisode),
        page,
        pageSize,
        total,
        pageCount,
      });
    }

    const query = paginationQuery.parse(request.query);
    const limit = clampLimit(query.limit);

    const cursor = decodeCursor(query.cursor);
    const keyset = cursor
      ? or(
          lt(episodes.publishedAt, new Date(cursor.sortValue)),
          and(eq(episodes.publishedAt, new Date(cursor.sortValue)), lt(episodes.id, cursor.id)),
        )
      : undefined;

    const rows = await app.db
      .select()
      .from(episodes)
      .where(keyset ? and(mine, keyset) : mine)
      .orderBy(...newestFirst)
      // One extra row answers "is there more?" without a second COUNT(*).
      .limit(limit + 1);

    const page = paginate(rows, limit, (row) => encodeCursor(row.publishedAt, row.id));

    return ok({
      items: page.items.map(serializeEpisode),
      nextCursor: page.nextCursor,
    });
  });

  app.get('/episodes/:id', { preHandler: catalogue }, async (request) => {
    const { id } = uuidParam.parse(request.params);

    const [row] = await app.db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!row) throw notFound('Episode');

    return ok({ episode: serializeEpisode(row) });
  });

  /**
   * The colour of this episode's own artwork.
   *
   * Its own route rather than part of the episode payload, because answering it
   * can mean fetching and analysing an image from a publisher's CDN — hundreds
   * of milliseconds that the episode page must not wait on. The player asks for
   * it after playback has already started and repaints when it arrives; until
   * then the show's colour stands in.
   *
   * Extracted once and stored. The second listener, and every listener after,
   * gets a row read. `expensive` because a miss reaches out to the internet.
   */
  app.get(
    '/episodes/:id/tint',
    { preHandler: rateLimit(app, 'expensive') },
    async (request) => {
      const { id } = uuidParam.parse(request.params);

      const [row] = await app.db
        .select({
          accentColor: episodes.accentColor,
          artworkUrl: episodes.artworkUrl,
          podcastId: episodes.podcastId,
        })
        .from(episodes)
        .where(eq(episodes.id, id))
        .limit(1);

      if (!row) throw notFound('Episode');
      if (row.accentColor) return ok({ accentColor: row.accentColor, source: 'episode' as const });

      /**
       * No episode art means there is nothing of its own to sample, so the
       * show's colour is not a fallback here — it is the correct answer, and
       * saying so stops the client asking again on every play.
       */
      if (!row.artworkUrl) {
        const [show] = await app.db
          .select({ accentColor: podcasts.accentColor })
          .from(podcasts)
          .where(eq(podcasts.id, row.podcastId))
          .limit(1);

        return ok({ accentColor: show?.accentColor ?? null, source: 'podcast' as const });
      }

      const extracted = await extractArtworkColor(row.artworkUrl);

      /**
       * A failed extraction is not stored.
       *
       * Null means "we could not tell" — an unreachable CDN, a timeout, a
       * genuinely greyscale cover. Writing that back would make one bad minute
       * permanent, so it stays null and the next play tries again. The cost of
       * retrying is one image fetch; the cost of caching a wrong answer is an
       * episode that never gets its colour.
       */
      if (extracted) {
        await app.db
          .update(episodes)
          .set({ accentColor: extracted })
          .where(eq(episodes.id, id));
      }

      return ok({ accentColor: extracted, source: 'episode' as const });
    },
  );
}

/** One query for a show's category names, rather than one per category. */
async function categoriesFor(app: FastifyInstance, podcastId: string): Promise<string[]> {
  const rows = await app.db
    .select({ name: categories.name })
    .from(podcastCategories)
    .innerJoin(categories, eq(categories.id, podcastCategories.categoryId))
    .where(eq(podcastCategories.podcastId, podcastId));

  return rows.map((row) => row.name);
}
