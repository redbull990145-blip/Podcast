/**
 * Playback position and queue, through the real HTTP layer and a real Postgres.
 *
 * The scenario that matters most has two devices writing to the same episode,
 * so it cannot be verified by calling a pure function — it needs the actual
 * read-reconcile-write path the server performs.
 */

import { episodes, podcasts } from '@cue/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { buildServer } from '../server.ts';

let app: FastifyInstance;
let cookie: string;
let episodeId: string;
let otherEpisodeId: string;

async function signUp(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery', name: 'Listener' },
  });

  const setCookie = response.headers['set-cookie'];
  return (Array.isArray(setCookie) ? setCookie : [setCookie ?? ''])
    .map((entry) => String(entry).split(';')[0])
    .join('; ');
}

function report(
  id: string,
  body: Record<string, unknown>,
  as: string = cookie,
) {
  return app.inject({
    method: 'PUT',
    url: `/me/progress/${id}`,
    headers: { cookie: as },
    payload: body,
  });
}

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
    .values({ feedUrl: 'https://example.com/playback.xml', title: 'Playback Show' })
    .returning({ id: podcasts.id });

  const rows = await app.db
    .insert(episodes)
    .values([
      {
        podcastId: show!.id,
        guid: 'ep-1',
        title: 'Episode One',
        audioUrl: 'https://cdn.example.com/1.mp3',
        publishedAt: new Date(),
        durationSec: 3600,
      },
      {
        podcastId: show!.id,
        guid: 'ep-2',
        title: 'Episode Two',
        audioUrl: 'https://cdn.example.com/2.mp3',
        publishedAt: new Date(),
        durationSec: 1800,
      },
    ])
    .returning({ id: episodes.id });

  episodeId = rows[0]!.id;
  otherEpisodeId = rows[1]!.id;
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  cookie = await signUp(`listener-${Math.random().toString(36).slice(2)}@example.com`);
});

describe('progress', () => {
  it('refuses anonymous callers', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/me/progress/${episodeId}`,
      payload: { positionSec: 100, deviceId: 'x' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('stores and returns a position', async () => {
    await report(episodeId, { positionSec: 742, durationSec: 3600, deviceId: 'phone' });

    const read = await app.inject({
      method: 'GET',
      url: `/me/progress/${episodeId}`,
      headers: { cookie },
    });

    expect(read.json().data.progress).toMatchObject({ positionSec: 742, deviceId: 'phone' });
  });

  it('returns null for an episode never played', async () => {
    const read = await app.inject({
      method: 'GET',
      url: `/me/progress/${otherEpisodeId}`,
      headers: { cookie },
    });

    expect(read.json().data.progress).toBeNull();
  });

  /**
   * The case the whole reconciliation exists for: a laptop left paused early
   * in the episode must not rewind a phone that is genuinely 20 minutes ahead
   * just because its heartbeat arrived second.
   */
  it('never rewinds a device that is genuinely further ahead', async () => {
    await report(episodeId, { positionSec: 2244, durationSec: 3600, deviceId: 'phone' });
    const response = await report(episodeId, {
      positionSec: 130,
      durationSec: 3600,
      deviceId: 'laptop',
    });

    expect(response.json().data.progress.positionSec).toBe(2244);
    // The losing client is told, in the same round trip, where it really is.
    expect(response.json().data.superseded).toBe(true);
  });

  it('accepts a genuinely later session that restarts the episode', async () => {
    const longAgo = Date.now() - 6 * 60 * 60 * 1000;

    await report(episodeId, {
      positionSec: 3000,
      durationSec: 3600,
      deviceId: 'phone',
      observedAt: longAgo,
    });
    const response = await report(episodeId, {
      positionSec: 40,
      durationSec: 3600,
      deviceId: 'phone',
    });

    expect(response.json().data.progress.positionSec).toBe(40);
  });

  it('ignores a client clock running ahead of the server', async () => {
    // Otherwise a device with a fast clock wins every race forever.
    const future = Date.now() + 10 * 60 * 60 * 1000;

    await report(episodeId, {
      positionSec: 90,
      durationSec: 3600,
      deviceId: 'fast-clock',
      observedAt: future,
    });

    const read = await app.inject({
      method: 'GET',
      url: `/me/progress/${episodeId}`,
      headers: { cookie },
    });

    expect(new Date(read.json().data.progress.updatedAt).getTime()).toBeLessThanOrEqual(
      Date.now() + 1000,
    );
  });

  it('keeps a completion against a later in-progress write', async () => {
    await report(episodeId, {
      positionSec: 3595,
      durationSec: 3600,
      completed: true,
      deviceId: 'phone',
    });
    const response = await report(episodeId, {
      positionSec: 1200,
      durationSec: 3600,
      deviceId: 'laptop',
    });

    expect(response.json().data.progress.completed).toBe(true);
  });

  it('is safe to retry — a duplicate write changes nothing', async () => {
    const body = { positionSec: 500, durationSec: 3600, deviceId: 'phone' };
    await report(episodeId, body);
    const second = await report(episodeId, body);

    expect(second.statusCode).toBe(200);
    expect(second.json().data.progress.positionSec).toBe(500);
  });

  it('rejects an implausible position rather than storing it', async () => {
    const response = await report(episodeId, { positionSec: -5, deviceId: 'phone' });
    expect(response.statusCode).toBe(400);
  });

  it('404s for an episode that does not exist', async () => {
    const response = await report('00000000-0000-4000-8000-000000000000', {
      positionSec: 10,
      deviceId: 'phone',
    });
    expect(response.statusCode).toBe(404);
  });

  it('keeps one user’s position out of another’s', async () => {
    const other = await signUp(`other-${Math.random().toString(36).slice(2)}@example.com`);
    await report(episodeId, { positionSec: 999, deviceId: 'phone' });

    const read = await app.inject({
      method: 'GET',
      url: `/me/progress/${episodeId}`,
      headers: { cookie: other },
    });

    expect(read.json().data.progress).toBeNull();
  });
});

describe('continue listening', () => {
  it('lists unfinished episodes, most recent first', async () => {
    await report(episodeId, { positionSec: 100, durationSec: 3600, deviceId: 'phone' });
    await report(otherEpisodeId, { positionSec: 200, durationSec: 1800, deviceId: 'phone' });

    const response = await app.inject({
      method: 'GET',
      url: '/me/continue',
      headers: { cookie },
    });

    const items = response.json().data.items;
    expect(items).toHaveLength(2);
    expect(items[0].episode.id).toBe(otherEpisodeId);
    // Carries enough of its show to render a row without a second request.
    expect(items[0].podcastTitle).toBe('Playback Show');
  });

  it('drops an episode once it is finished', async () => {
    await report(episodeId, {
      positionSec: 3600,
      durationSec: 3600,
      completed: true,
      deviceId: 'phone',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/me/continue',
      headers: { cookie },
    });

    expect(response.json().data.items).toHaveLength(0);
  });
});

describe('queue', () => {
  function enqueue(id: string, playNext = false) {
    return app.inject({
      method: 'POST',
      url: '/me/queue',
      headers: { cookie },
      payload: { episodeId: id, playNext },
    });
  }

  async function readQueue(): Promise<string[]> {
    const response = await app.inject({ method: 'GET', url: '/me/queue', headers: { cookie } });
    return response.json().data.items.map((item: { episode: { id: string } }) => item.episode.id);
  }

  it('appends in order', async () => {
    await enqueue(episodeId);
    await enqueue(otherEpisodeId);

    expect(await readQueue()).toEqual([episodeId, otherEpisodeId]);
  });

  it('puts a play-next item at the front', async () => {
    await enqueue(episodeId);
    await enqueue(otherEpisodeId, true);

    expect(await readQueue()).toEqual([otherEpisodeId, episodeId]);
  });

  it('treats queueing the same episode twice as success', async () => {
    await enqueue(episodeId);
    const second = await enqueue(episodeId);

    expect(second.statusCode).toBe(200);
    expect(await readQueue()).toHaveLength(1);
  });

  it('reorders', async () => {
    await enqueue(episodeId);
    await enqueue(otherEpisodeId);

    await app.inject({
      method: 'PUT',
      url: '/me/queue/order',
      headers: { cookie },
      payload: { episodeIds: [otherEpisodeId, episodeId] },
    });

    expect(await readQueue()).toEqual([otherEpisodeId, episodeId]);
  });

  it('ignores episodes that are not in the caller’s queue when reordering', async () => {
    // A reorder must not be able to reach into another user's queue.
    await enqueue(episodeId);

    const response = await app.inject({
      method: 'PUT',
      url: '/me/queue/order',
      headers: { cookie },
      payload: { episodeIds: ['00000000-0000-4000-8000-000000000000', episodeId] },
    });

    expect(response.json().data.reordered).toBe(1);
  });

  it('removes and clears', async () => {
    await enqueue(episodeId);
    await enqueue(otherEpisodeId);

    await app.inject({ method: 'DELETE', url: `/me/queue/${episodeId}`, headers: { cookie } });
    expect(await readQueue()).toEqual([otherEpisodeId]);

    await app.inject({ method: 'DELETE', url: '/me/queue', headers: { cookie } });
    expect(await readQueue()).toEqual([]);
  });

  it('404s when queueing an episode that does not exist', async () => {
    const response = await enqueue('00000000-0000-4000-8000-000000000000');
    expect(response.statusCode).toBe(404);
  });
});
