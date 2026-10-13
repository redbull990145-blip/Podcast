/**
 * The episode tint endpoint, against a real database.
 *
 * The behaviour worth pinning is not "it returns a colour" — it is *when it
 * reaches the network and when it does not*. This route is the only public one
 * that can fetch an arbitrary publisher image, so the caching and the fallbacks
 * are the whole design: get them wrong and opening the player hits a CDN every
 * time, or worse, caches a failure permanently and leaves an episode grey
 * forever.
 */

import { episodes, podcasts } from '@cue/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.ts';
import { buildServer } from '../server.ts';
import * as transport from '../feed/pinned-fetch.ts';

/**
 * Stand in for one artwork URL and one only.
 *
 * Replacing `globalThis.fetch` wholesale is what this avoids. Vitest can run
 * files concurrently in a shared process, and a blanket mock leaks — it took
 * down `playback.test.ts` at setup once, because signing a user in also calls
 * fetch and got this file's rejection instead. Delegating everything that is
 * not the URL under test back to the real implementation means the mock cannot
 * break a suite it was never aimed at.
 */
function mockArtworkFetch(url: string, answer: () => Promise<Response>) {
  const real = transport.fetchChecked;

  return vi.spyOn(transport, 'fetchChecked').mockImplementation((check, init, fetchImpl) => {
    return check.url.href === url ? answer() : real(check, init, fetchImpl);
  });
}

let app: FastifyInstance;
let showId: string;
/** Has its own artwork. */
let withArt: string;
/** Has none, so the show's colour is the honest answer. */
let withoutArt: string;
/** Its artwork will fail to fetch. */
let brokenArt: string;

const SHOW_COLOR = '#0166B8';

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
      feedUrl: 'https://example.com/tint.xml',
      title: 'Tint Show',
      artworkUrl: 'https://cdn.example.com/show.jpg',
      accentColor: SHOW_COLOR,
    })
    .returning({ id: podcasts.id });

  showId = show!.id;

  const rows = await app.db
    .insert(episodes)
    .values(
      [
        // Literal public IPs, not a hostname: the SSRF guard added in
        // artwork-color.ts resolves hostnames and would refuse a non-resolving
        // test host before fetch is ever reached. A literal IP skips DNS, and
        // these documentation-range addresses (TEST-NET-2) are treated as public
        // by the guard, so the mocked fetch below is what actually answers.
        { guid: 'tint-art', artworkUrl: 'http://198.51.100.10/ep-art.jpg' },
        { guid: 'tint-none', artworkUrl: null },
        { guid: 'tint-broken', artworkUrl: 'http://198.51.100.11/ep-broken.jpg' },
      ].map((e, n) => ({
        podcastId: showId,
        guid: e.guid,
        title: `Episode ${n}`,
        audioUrl: `https://cdn.example.com/tint-${n}.mp3`,
        publishedAt: new Date(),
        artworkUrl: e.artworkUrl,
      })),
    )
    .returning({ id: episodes.id });

  [withArt, withoutArt, brokenArt] = rows.map((row) => row.id) as [string, string, string];
});

afterAll(async () => {
  await app.close();
});

// Belt as well as braces: even a scoped spy must not outlive its test.
afterEach(() => {
  vi.restoreAllMocks();
});

function tintOf(id: string) {
  return app.inject({ method: 'GET', url: `/episodes/${id}/tint` });
}

describe('an episode with no artwork of its own', () => {
  it("answers with the show's colour and calls it the show's", async () => {
    // Not a fallback dressed up as an episode colour: there is nothing of this
    // episode's own to sample, so `podcast` is the truthful source. A client
    // that saw `source: 'episode'` here would have no way to know the value
    // will never improve.
    const response = await tintOf(withoutArt);

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ accentColor: SHOW_COLOR, source: 'podcast' });
  });

  it('never reaches the network for it', async () => {
    const fetchSpy = vi.spyOn(transport, 'fetchChecked');
    await tintOf(withoutArt);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('an episode whose artwork cannot be read', () => {
  it('answers null rather than failing the request', async () => {
    // A dead CDN is not a broken endpoint. The player has a colour already —
    // the show's — and a 500 here would turn a cosmetic miss into an error.
    mockArtworkFetch('http://198.51.100.11/ep-broken.jpg', () =>
      Promise.reject(new Error('ENOTFOUND 198.51.100.11')),
    );

    const response = await tintOf(brokenArt);

    expect(response.statusCode).toBe(200);
    expect(response.json().data.accentColor).toBeNull();
  });

  it('does not store the failure, so a later attempt can still succeed', async () => {
    // The important half. Caching null would make one bad minute permanent and
    // leave the episode grey for the life of the row.
    const [row] = await app.db
      .select({ accentColor: episodes.accentColor })
      .from(episodes)
      .where(eq(episodes.id, brokenArt))
      .limit(1);

    expect(row?.accentColor).toBeNull();
  });
});

describe('an episode with its own artwork', () => {
  it('extracts once, stores it, and reads the row every time after', async () => {
    // A 1×1 red PNG is enough: this asserts the plumbing and the caching, not
    // the colour maths, which has its own tests.
    const red = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    const fetchSpy = mockArtworkFetch('http://198.51.100.10/ep-art.jpg', () =>
      Promise.resolve(
        new Response(red, { status: 200, headers: { 'content-type': 'image/png' } }),
      ),
    );

    const first = await tintOf(withArt);
    expect(first.statusCode).toBe(200);
    expect(first.json().data.source).toBe('episode');

    const callsAfterFirst = fetchSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second request must be a row read. This is what keeps a popular episode
    // from becoming a stream of requests to somebody else's CDN.
    const second = await tintOf(withArt);
    expect(second.json().data).toEqual(first.json().data);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('an episode that does not exist', () => {
  it('is a 404, not a null colour', async () => {
    const response = await tintOf('00000000-0000-4000-8000-000000000000');

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
  });
});
