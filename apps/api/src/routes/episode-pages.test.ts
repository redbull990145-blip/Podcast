/**
 * Numbered paging over a show's archive.
 *
 * `GET /podcasts/:id/episodes` answers in two shapes now, and the interesting
 * cases are all at the seams: that asking for a page does not disturb the
 * cursor path every other caller uses, that the arithmetic holds when the total
 * is not a clean multiple of the page size, and that a page number from outside
 * the archive produces something a person can act on.
 *
 * Driven through HTTP against a real Postgres rather than by calling the
 * handler, because half of what is being tested is query-string coercion —
 * `?page=3` arrives as the string `"3"`, and a pager that works in a unit test
 * and 400s in a browser is the failure this shape exists to catch.
 */

import { episodes, podcasts } from '@cue/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { buildServer } from '../server.ts';

let app: FastifyInstance;
let podcastId: string;

/**
 * Twenty-five episodes, which is deliberately not a multiple of ten.
 *
 * A round number would let an off-by-one in `pageCount` pass — 20 episodes at
 * 10 a page is 2 either way you round it. Twenty-five is 3 pages with a short
 * last one, which is the only arrangement that distinguishes `ceil` from
 * `floor` from `round`.
 */
const TOTAL = 25;
const PAGE_SIZE = 10;

beforeAll(async () => {
  app = await buildServer(
    loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'pglite://memory',
      CORS_ORIGINS: 'http://localhost:3000',
    }),
  );
  await app.ready();

  const [show] = await app.db
    .insert(podcasts)
    .values({
      title: 'The Archive',
      feedUrl: 'https://example.com/archive.xml',
      author: 'A Publisher',
      source: 'seed',
      episodeCount: TOTAL,
    })
    .returning({ id: podcasts.id });

  podcastId = show!.id;

  // Published a day apart so ordering is total and unambiguous — episode 1 is
  // the newest, episode 25 the oldest.
  await app.db.insert(episodes).values(
    Array.from({ length: TOTAL }, (_, index) => ({
      podcastId,
      guid: `episode-${index + 1}`,
      title: `Episode ${index + 1}`,
      audioUrl: `https://example.com/${index + 1}.mp3`,
      publishedAt: new Date(Date.UTC(2026, 0, TOTAL - index)),
    })),
  );
});

afterAll(async () => {
  await app.close();
});

async function page(query: string): Promise<{
  items: { title: string }[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}> {
  const response = await app.inject({
    method: 'GET',
    url: `/podcasts/${podcastId}/episodes?${query}`,
  });

  expect(response.statusCode).toBe(200);
  return JSON.parse(response.body).data;
}

describe('episode paging', () => {
  it('counts the whole archive rather than the page', async () => {
    const first = await page(`page=1&limit=${PAGE_SIZE}`);

    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first.total).toBe(TOTAL);
    // 25 across 10 is three pages, the last one half empty — not two.
    expect(first.pageCount).toBe(3);
    expect(first.page).toBe(1);
    expect(first.pageSize).toBe(PAGE_SIZE);
  });

  it('walks the archive newest to oldest without gaps or repeats', async () => {
    const walked: string[] = [];
    for (const number of [1, 2, 3]) {
      const result = await page(`page=${number}&limit=${PAGE_SIZE}`);
      walked.push(...result.items.map((item) => item.title));
    }

    expect(walked).toHaveLength(TOTAL);
    expect(new Set(walked).size).toBe(TOTAL);
    expect(walked[0]).toBe('Episode 1');
    expect(walked.at(-1)).toBe(`Episode ${TOTAL}`);
  });

  it('leaves the last page short rather than padding it', async () => {
    const last = await page(`page=3&limit=${PAGE_SIZE}`);
    expect(last.items).toHaveLength(TOTAL - 2 * PAGE_SIZE);
  });

  /**
   * A stale link, or a pager rendered against a count that has since shrunk.
   * The listener gets the end of the archive and a pager that agrees with
   * itself, rather than a blank screen or a 404 they cannot act on.
   */
  it('clamps a page past the end to the last real one', async () => {
    const beyond = await page(`page=900&limit=${PAGE_SIZE}`);

    expect(beyond.page).toBe(3);
    expect(beyond.items).toHaveLength(TOTAL - 2 * PAGE_SIZE);
  });

  it('rejects a page number that is not one', async () => {
    // Not clamped, unlike the upper end: `?page=0` and `?page=-1` are not a
    // listener at the edge of an archive, they are a malformed request, and
    // answering them as if they meant page 1 hides a bug in whatever built it.
    for (const bad of ['0', '-3', 'banana', '2.5']) {
      const response = await app.inject({
        method: 'GET',
        url: `/podcasts/${podcastId}/episodes?page=${bad}`,
      });

      expect(response.statusCode).toBe(400);
    }
  });

  /**
   * The path every other caller in the app still takes.
   *
   * Adding a mode is only safe if the absence of the new parameter is
   * indistinguishable from before — a cursor response must not grow a `page`
   * field, and must keep the `nextCursor` that infinite lists page on.
   */
  it('leaves the cursor path untouched when no page is asked for', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/podcasts/${podcastId}/episodes?limit=${PAGE_SIZE}`,
    });

    const body = JSON.parse(response.body).data;

    expect(body.items).toHaveLength(PAGE_SIZE);
    expect(body.nextCursor).toBeTruthy();
    expect(body).not.toHaveProperty('page');
    expect(body).not.toHaveProperty('total');
  });
});
