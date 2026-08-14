/**
 * Catalog endpoints.
 *
 * Everything here is public and cacheable — no session, no user data. That is
 * what lets these responses be cached aggressively at every layer.
 */

import { clampLimit, decodeCursor, encodeCursor, paginate, podcasts, episodes, categories, podcastCategories } from '@cue/db';
import type { PodcastSearchResult } from '@cue/types';
import { feedUrlInput, paginationQuery, searchQuery, uuidParam } from '@cue/validation';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { PodcastIndexFeed } from '../catalog/podcastindex.ts';
import { serializeEpisode, serializePodcast } from '../catalog/serialize.ts';
import { ingestFeed } from '../feed/ingest.ts';
import { normalizeFeedUrl } from '../feed/url-guard.ts';
import { badRequest, notFound, ok } from '../errors.ts';
import { rateLimit } from '../rate-limit.ts';

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

export function podcastRoutes(app: FastifyInstance): void {
  /**
   * Search. Hits PodcastIndex rather than our own table, because the catalog
   * is only what users have already added — searching it would mean an empty
   * app for the first person to look for anything.
   */
  app.get('/podcasts/search', { preHandler: rateLimit(app, 'search') }, async (request) => {
    const query = searchQuery.parse(request.query);

    const feeds = await app.podcastIndex.search(query.q, {
      ...(query.language ? { language: query.language } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    });

    return ok({ results: feeds.map(serializeDirectoryFeed) });
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

    const result = await ingestFeed(app.db, normalized.href);

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
  app.get('/podcasts', async (request) => {
    const query = paginationQuery.parse(request.query);
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

    const rows = await app.db
      .select()
      .from(podcasts)
      .where(keyset)
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

  app.get('/podcasts/:id', async (request) => {
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
  app.get('/podcasts/:id/episodes', async (request) => {
    const { id } = uuidParam.parse(request.params);
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
      .where(keyset ? and(eq(episodes.podcastId, id), keyset) : eq(episodes.podcastId, id))
      .orderBy(desc(episodes.publishedAt), desc(episodes.id))
      // One extra row answers "is there more?" without a second COUNT(*).
      .limit(limit + 1);

    const page = paginate(rows, limit, (row) => encodeCursor(row.publishedAt, row.id));

    return ok({
      items: page.items.map(serializeEpisode),
      nextCursor: page.nextCursor,
    });
  });

  app.get('/episodes/:id', async (request) => {
    const { id } = uuidParam.parse(request.params);

    const [row] = await app.db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!row) throw notFound('Episode');

    return ok({ episode: serializeEpisode(row) });
  });
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
