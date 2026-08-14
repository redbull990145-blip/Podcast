/**
 * The two directory endpoints.
 *
 * They exist to feed one list component, so the thing worth testing is not
 * that either works alone — it is that they agree. `/podcasts/trending` used
 * to return the upstream feed unmapped, which calls the subscribe target `url`
 * where ours calls it `feedUrl`. Every field a person could see was correct and
 * the one the Add button needed was missing, so trending rendered perfectly and
 * could not be acted on.
 *
 * No database: neither route touches one. PodcastIndex is faked because this is
 * about our own wire shape, not about the directory being reachable.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PodcastIndexFeed } from '../catalog/podcastindex.ts';
import { loadConfig } from '../config.ts';
import { buildServer } from '../server.ts';

const FEED: PodcastIndexFeed = {
  id: 42,
  title: 'Planet Money',
  url: 'https://feeds.npr.org/510289/podcast.xml',
  author: 'NPR',
  description: 'The economy explained.',
  artworkUrl: 'https://example.com/art.jpg',
  websiteUrl: 'https://npr.org/planetmoney',
  language: 'en',
  categories: ['Business'],
  explicit: false,
  episodeCount: 1200,
  lastPublishedAt: '2026-01-01T00:00:00.000Z',
};

let app: FastifyInstance;

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
    search: async () => [FEED],
    trending: async () => [FEED],
    byFeedUrl: async () => FEED,
  };
});

afterAll(async () => {
  await app.close();
});

async function results(url: string): Promise<Record<string, unknown>[]> {
  const response = await app.inject({ method: 'GET', url });
  expect(response.statusCode).toBe(200);
  return response.json().data.results;
}

describe('directory endpoints', () => {
  it('names the subscribe target `feedUrl` in search', async () => {
    const [first] = await results('/podcasts/search?q=planet+money');
    expect(first).toMatchObject({ feedUrl: FEED.url, title: FEED.title });
  });

  it('names it the same way in trending', async () => {
    // The regression. `url` here instead of `feedUrl` is invisible until
    // someone tries to add a trending show.
    const [first] = await results('/podcasts/trending');
    expect(first).toMatchObject({ feedUrl: FEED.url });
    expect(first).not.toHaveProperty('url');
  });

  it('returns identical field sets from both, so one component renders either', async () => {
    const [fromSearch] = await results('/podcasts/search?q=planet+money');
    const [fromTrending] = await results('/podcasts/trending');

    expect(Object.keys(fromTrending!).sort()).toEqual(Object.keys(fromSearch!).sort());
  });

  it('keeps upstream-internal fields off our wire', async () => {
    // The directory's own row id and website are not ours to expose, and
    // shipping them invites a client to depend on a third party's schema.
    const [first] = await results('/podcasts/trending');
    expect(first).not.toHaveProperty('id');
    expect(first).not.toHaveProperty('websiteUrl');
  });

  it('passes a language filter through to the directory', async () => {
    let seen: string | undefined;
    app.podcastIndex.trending = async (options) => {
      seen = options?.language;
      return [FEED];
    };

    await results('/podcasts/trending?language=hi');
    expect(seen).toBe('hi');
  });
});
