/**
 * How search results get ordered.
 *
 * PodcastIndex returns what it returns — a relevance order tuned for a
 * directory, not for a listener typing three letters into a phone. Handing
 * that straight through is what put unrelated shows above the one somebody was
 * obviously reaching for, so the ranking here is the product decision and
 * these are the tests that hold it.
 *
 * No database: this route never touches one. The directory is faked because
 * the subject is our ordering, not whether PodcastIndex is reachable — and
 * because a ranking test that depends on a third party's current index proves
 * nothing the day it changes.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PodcastIndexFeed } from '../catalog/podcastindex.ts';
import { loadConfig } from '../config.ts';
import { buildServer } from '../server.ts';

let app: FastifyInstance;

function feed(overrides: Partial<PodcastIndexFeed> & { title: string }): PodcastIndexFeed {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    url: `https://example.com/${overrides.title.toLowerCase().replace(/\W+/g, '-')}.xml`,
    author: null,
    description: null,
    artworkUrl: null,
    websiteUrl: null,
    language: 'en',
    categories: [],
    explicit: false,
    episodeCount: 100,
    lastPublishedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Run a search against a fixed upstream answer and return the titles, in order. */
async function titles(query: string, upstream: PodcastIndexFeed[]): Promise<string[]> {
  app.podcastIndex.search = async () => upstream;

  const response = await app.inject({
    method: 'GET',
    url: `/podcasts/search?q=${encodeURIComponent(query)}`,
  });

  expect(response.statusCode).toBe(200);
  return response
    .json()
    .data.results.map((result: { title: string }) => result.title);
}

beforeAll(async () => {
  app = await buildServer(
    loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
      CORS_ORIGINS: 'http://localhost:3000',
      PODCASTINDEX_KEY: 'test-key',
      PODCASTINDEX_SECRET: 'test-secret',
    }),
  );

  app.podcastIndex = {
    search: async () => [],
    trending: async () => [],
    byFeedUrl: async () => feed({ title: 'Anything' }),
  };
});

afterAll(async () => {
  await app.close();
});

describe('search ranking', () => {
  /**
   * The complaint that started this: typing a few letters of a host's name and
   * getting a wall of unrelated shows, with the obvious answer somewhere below
   * the fold. Upstream is deliberately given in the worst possible order.
   */
  it('surfaces a show from a fragment of its title, without the rest of it', async () => {
    const ordered = await titles('joe', [
      feed({ title: 'Gardening Weekly' }),
      feed({ title: 'Market Movers' }),
      feed({ title: 'The Joe Rogan Experience', author: 'Joe Rogan' }),
      feed({ title: 'Quiet Hours' }),
    ]);

    expect(ordered[0]).toBe('The Joe Rogan Experience');
  });

  it('ranks an exact title above one that merely starts with the query', async () => {
    const ordered = await titles('planet money', [
      feed({ title: 'Planet Money Shorts' }),
      feed({ title: 'Planet Money' }),
    ]);

    expect(ordered).toEqual(['Planet Money', 'Planet Money Shorts']);
  });

  it('ranks a title prefix above a title that only contains the query', async () => {
    const ordered = await titles('history', [
      feed({ title: 'A Short History of Nearly Everything' }),
      feed({ title: 'History Daily' }),
    ]);

    expect(ordered).toEqual(['History Daily', 'A Short History of Nearly Everything']);
  });

  /**
   * Somebody searching a creator's name is searching for their work. The title
   * match still wins — it is a stronger statement of intent — but the author
   * match has to beat a show that merely mentions the word in its blurb.
   */
  it('puts a creator match above a description mention', async () => {
    const ordered = await titles('malcolm gladwell', [
      feed({
        title: 'Book Chat',
        description: 'This week: what Malcolm Gladwell gets wrong about talent.',
      }),
      feed({ title: 'Revisionist History', author: 'Malcolm Gladwell' }),
    ]);

    expect(ordered[0]).toBe('Revisionist History');
  });

  it('matches on category when nothing else does', async () => {
    const ordered = await titles('true crime', [
      feed({ title: 'Numbers Hour', categories: ['Business'] }),
      feed({ title: 'Cold Cases', categories: ['True Crime'] }),
    ]);

    expect(ordered[0]).toBe('Cold Cases');
  });

  /**
   * Typing is the input method here, and a phone keyboard makes this mistake
   * constantly. One edit for a short word, two for a longer one — enough to
   * recover a fat-fingered name, not so much that unrelated words start
   * matching each other.
   */
  it('recovers from a typo in a long enough word', async () => {
    const ordered = await titles('roggan', [
      feed({ title: 'Gardening Weekly' }),
      feed({ title: 'The Joe Rogan Experience', author: 'Joe Rogan' }),
    ]);

    expect(ordered[0]).toBe('The Joe Rogan Experience');
  });

  it('ignores case and punctuation on both sides', async () => {
    const ordered = await titles('99% INVISIBLE', [
      feed({ title: 'Design Notes' }),
      feed({ title: '99% Invisible' }),
    ]);

    expect(ordered[0]).toBe('99% Invisible');
  });

  /**
   * The same feed reached by two URLs is one show. Duplicates are common
   * upstream — a trailing slash, a fragment, a capitalised host — and they cost
   * a slot each in a list of ten.
   */
  it('collapses the same feed reached by different URLs', async () => {
    const ordered = await titles('daily', [
      feed({ title: 'The Daily', url: 'https://feeds.example.com/daily.xml' }),
      feed({ title: 'The Daily (duplicate)', url: 'https://feeds.example.com/daily.xml#x' }),
      feed({ title: 'The Daily (also)', url: 'https://FEEDS.example.com/daily.xml' }),
    ]);

    expect(ordered).toEqual(['The Daily']);
  });

  /**
   * A show with no author, no categories and no description is not malformed,
   * it is just thin — a large share of the directory looks like this. It must
   * score, not throw.
   */
  it('survives feeds missing every optional field', async () => {
    const ordered = await titles('quiet', [
      feed({ title: 'Quiet Hours', author: null, description: null, categories: [] }),
      feed({ title: 'Loud Hours', author: null, description: null, categories: [] }),
    ]);

    expect(ordered[0]).toBe('Quiet Hours');
  });

  /**
   * Ranking only works on what it is given, so the route asks the directory for
   * a deeper pool than the caller wants and does the choosing itself. Asking
   * for exactly ten and re-ordering those ten would leave the eleventh — which
   * might be the exact title match — permanently invisible.
   */
  it('reads a deeper pool from the directory than the caller asked for', async () => {
    let requested: number | undefined;
    app.podcastIndex.search = async (_query, options) => {
      requested = options?.limit;
      return [feed({ title: 'Planet Money' })];
    };

    await app.inject({ method: 'GET', url: '/podcasts/search?q=planet&limit=5' });
    expect(requested).toBeGreaterThanOrEqual(50);
  });

  it('still returns no more than the caller asked for', async () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      feed({ title: `Money Show ${index}` }),
    );

    app.podcastIndex.search = async () => many;
    const response = await app.inject({
      method: 'GET',
      url: '/podcasts/search?q=money&limit=5',
    });

    expect(response.json().data.results).toHaveLength(5);
  });

  /**
   * Language is a filter the reader chose, not a region baked into the app. It
   * nudges the order and never removes anything, so a Hindi filter cannot hide
   * a show whose feed forgot to declare a language — which many do.
   */
  it('lets an explicit language filter break a tie without excluding anyone', async () => {
    app.podcastIndex.search = async () => [
      feed({ title: 'Kahani', language: 'en' }),
      feed({ title: 'Kahani', language: 'hi', url: 'https://example.com/kahani-hi.xml' }),
    ];

    const response = await app.inject({
      method: 'GET',
      url: '/podcasts/search?q=kahani&language=hi',
    });

    const results = response.json().data.results;
    expect(results).toHaveLength(2);
    expect(results[0].feedUrl).toBe('https://example.com/kahani-hi.xml');
  });
});
