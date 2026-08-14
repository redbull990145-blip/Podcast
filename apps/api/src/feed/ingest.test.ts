/**
 * Ingest, against a real Postgres.
 *
 * These are the tests that matter most in this phase: the upsert semantics and
 * the keyset pagination are where "shows stuck at 50 episodes" and "duplicate
 * episodes after a refresh" actually come from.
 */

import { episodes, podcasts, type Database } from '@cue/db';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clampLimit, decodeCursor, encodeCursor, paginate } from '@cue/db';
import { createTestDatabase, type TestDatabase } from '../test/database.ts';
import { partiallyBrokenFeed, wellFormedFeed } from './fixtures.ts';
import { ingestFeed } from './ingest.ts';

const FEED_URL = 'https://example.com/feed.xml';

/** A fetch that never touches the network. */
function stubFetch(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): typeof fetch {
  const status = init.status ?? 200;
  // 204/205/304 are null-body statuses; the Response constructor throws if
  // given one with a body, which would surface as a network error instead.
  const payload = status === 204 || status === 205 || status === 304 ? null : body;

  return (async () =>
    new Response(payload, {
      status,
      headers: { 'content-type': 'application/rss+xml', ...init.headers },
    })) as unknown as typeof fetch;
}

/** Builds a feed with `count` episodes, to test chunking and paging. */
function largeFeed(count: number): string {
  const items = Array.from({ length: count }, (_, i) => {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String((i % 12) + 1).padStart(2, '0');
    const year = 2000 + Math.floor(i / 300);
    return `<item>
      <title>Episode ${i}</title>
      <guid>ep-${i}</guid>
      <pubDate>${year}-${month}-${day}T09:00:00Z</pubDate>
      <enclosure url="https://cdn.example.com/${i}.mp3" type="audio/mpeg"/>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>Big Show</title><description>Many episodes.</description>${items}
  </channel></rss>`;
}

// One Postgres for the file, truncated between tests. Booting a fresh one per
// test costs ~5s each and turns a fast suite into one nobody runs.
let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.$close();
});

beforeEach(async () => {
  await db.$reset();
});

describe('ingestFeed', () => {
  it('writes the show and its episodes', async () => {
    const result = await ingestFeed(db as unknown as Database, FEED_URL, {
      fetchImpl: stubFetch(wellFormedFeed),
    });

    expect(result.status).toBe('ingested');
    if (result.status !== 'ingested') return;
    expect(result.episodesWritten).toBe(2);

    const [show] = await db.select().from(podcasts).where(eq(podcasts.id, result.podcastId));
    expect(show?.title).toBe('The Long Way Round');
    expect(show?.language).toBe('en-gb');
    expect(show?.episodeCount).toBe(2);
    // Bookkeeping for the next conditional request.
    expect(show?.lastFetchedAt).toBeInstanceOf(Date);
  });

  it('is idempotent — re-ingesting updates instead of duplicating', async () => {
    const fetchImpl = stubFetch(wellFormedFeed);

    const first = await ingestFeed(db as unknown as Database, FEED_URL, { fetchImpl });
    const second = await ingestFeed(db as unknown as Database, FEED_URL, { fetchImpl });

    expect(first.status).toBe('ingested');
    expect(second.status).toBe('ingested');

    const rows = await db.select().from(episodes);
    expect(rows).toHaveLength(2);

    const shows = await db.select().from(podcasts);
    expect(shows).toHaveLength(1);
  });

  it('lands corrections a publisher makes to an existing episode', async () => {
    await ingestFeed(db as unknown as Database, FEED_URL, {
      fetchImpl: stubFetch(wellFormedFeed),
    });

    const corrected = wellFormedFeed.replace(
      '<title>Starting from nothing</title>',
      '<title>Starting from nothing (remastered)</title>',
    );
    await ingestFeed(db as unknown as Database, FEED_URL, { fetchImpl: stubFetch(corrected) });

    const [row] = await db.select().from(episodes).where(eq(episodes.guid, 'episode-001'));
    expect(row?.title).toBe('Starting from nothing (remastered)');

    // Still one row — a correction is an update, not a new episode.
    expect(await db.select().from(episodes)).toHaveLength(2);
  });

  it('skips broken items but keeps the show', async () => {
    const result = await ingestFeed(db as unknown as Database, FEED_URL, {
      fetchImpl: stubFetch(partiallyBrokenFeed),
    });

    expect(result.status).toBe('ingested');
    if (result.status !== 'ingested') return;
    expect(result.episodesWritten).toBe(1);
    expect(result.episodesSkipped).toBe(3);
  });

  it('does no work when the publisher answers 304', async () => {
    await ingestFeed(db as unknown as Database, FEED_URL, {
      fetchImpl: stubFetch(wellFormedFeed, { headers: { etag: '"v1"' } }),
    });

    const result = await ingestFeed(db as unknown as Database, FEED_URL, {
      fetchImpl: stubFetch('', { status: 304 }),
    });

    expect(result.status).toBe('unchanged');
    // The saved etag is what made the conditional request possible.
    const [show] = await db.select().from(podcasts);
    expect(show?.etag).toBe('"v1"');
  });

  it('marks a 404 feed as gone so the refresh cycle stops retrying it', async () => {
    await ingestFeed(db as unknown as Database, FEED_URL, {
      fetchImpl: stubFetch(wellFormedFeed),
    });

    const result = await ingestFeed(db as unknown as Database, FEED_URL, {
      fetchImpl: stubFetch('', { status: 404 }),
    });

    expect(result.status).toBe('gone');
    const [show] = await db.select().from(podcasts);
    expect(show?.fetchFailureCount).toBeGreaterThanOrEqual(10);
  });

  it('counts failures so a flaky feed can be backed off', async () => {
    await ingestFeed(db as unknown as Database, FEED_URL, {
      fetchImpl: stubFetch(wellFormedFeed),
    });

    await ingestFeed(db as unknown as Database, FEED_URL, {
      fetchImpl: stubFetch('', { status: 500 }),
    });

    const [show] = await db.select().from(podcasts);
    expect(show?.fetchFailureCount).toBe(1);
  });

  it('resets the failure count once a feed recovers', async () => {
    await ingestFeed(db as unknown as Database, FEED_URL, { fetchImpl: stubFetch(wellFormedFeed) });
    await ingestFeed(db as unknown as Database, FEED_URL, { fetchImpl: stubFetch('', { status: 500 }) });
    await ingestFeed(db as unknown as Database, FEED_URL, { fetchImpl: stubFetch(wellFormedFeed) });

    const [show] = await db.select().from(podcasts);
    expect(show?.fetchFailureCount).toBe(0);
  });

  it('writes every episode of a show larger than one INSERT can carry', async () => {
    // 900 episodes exceeds the 200-row chunk. This is the "stuck at a round
    // number" bug: a show that silently truncates at some page size.
    const result = await ingestFeed(db as unknown as Database, FEED_URL, {
      fetchImpl: stubFetch(largeFeed(900)),
    });

    expect(result.status).toBe('ingested');
    if (result.status !== 'ingested') return;
    expect(result.episodesWritten).toBe(900);
    expect(await db.select().from(episodes)).toHaveLength(900);
  });
});

describe('keyset pagination against real SQL', () => {
  beforeEach(async () => {
    await ingestFeed(db as unknown as Database, FEED_URL, {
      fetchImpl: stubFetch(largeFeed(250)),
    });
  });

  /** Mirrors the query in routes/podcasts.ts. */
  async function page(podcastId: string, cursor: string | null, limit: number) {
    const decoded = decodeCursor(cursor);
    const keyset = decoded
      ? or(
          lt(episodes.publishedAt, new Date(decoded.sortValue)),
          and(eq(episodes.publishedAt, new Date(decoded.sortValue)), lt(episodes.id, decoded.id)),
        )
      : undefined;

    const rows = await db
      .select()
      .from(episodes)
      .where(keyset ? and(eq(episodes.podcastId, podcastId), keyset) : eq(episodes.podcastId, podcastId))
      .orderBy(desc(episodes.publishedAt), desc(episodes.id))
      .limit(limit + 1);

    return paginate(rows, limit, (row) => encodeCursor(row.publishedAt, row.id));
  }

  it('walks the whole show without repeating or skipping an episode', async () => {
    const [show] = await db.select().from(podcasts);
    const limit = clampLimit(40);

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;

    do {
      const result = await page(show!.id, cursor, limit);
      for (const row of result.items) {
        // A repeat means the cursor tiebreaker is wrong.
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = result.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(20); // guard against an infinite loop
    } while (cursor);

    expect(seen.size).toBe(250);
  });

  it('returns episodes newest first', async () => {
    const [show] = await db.select().from(podcasts);
    const result = await page(show!.id, null, 10);

    const times = result.items.map((row) => row.publishedAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('separates episodes published at the same instant instead of dropping one', async () => {
    // The `largeFeed` generator repeats dates deliberately. Without the id
    // tiebreaker, same-second episodes straddle a page boundary and one is
    // never returned.
    const [show] = await db.select().from(podcasts);

    const first = await page(show!.id, null, 5);
    const second = await page(show!.id, first.nextCursor, 5);

    const overlap = first.items.filter((a) => second.items.some((b) => b.id === a.id));
    expect(overlap).toEqual([]);
  });
});
