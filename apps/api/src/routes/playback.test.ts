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
    headers: { origin: app.config.corsOrigins[0], cookie: as },
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
  it.each([false, true])('reconciles simultaneous first writes in either request order (%s)', async (reverse) => {
    const observedAt = Date.now() - 100;
    const writes = [{ positionSec: 900, deviceId: 'ahead', observedAt }, { positionSec: 100, deviceId: 'behind', observedAt }];
    if (reverse) writes.reverse();
    const responses = await Promise.all(writes.map((input) => report(episodeId, input)));
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    const read = await app.inject({ method: 'GET', url: `/me/progress/${episodeId}`, headers: { origin: app.config.corsOrigins[0], cookie } });
    expect(read.json().data.progress).toMatchObject({ positionSec: 900, deviceId: 'ahead' });
  });
  it('keeps completion when simultaneous near-time progress updates arrive', async () => {
    await report(episodeId, { positionSec: 500, deviceId: 'initial', observedAt: Date.now() - 1000 });
    const observedAt = Date.now() - 100;
    await Promise.all([
      report(episodeId, { positionSec: 3600, durationSec: 3600, completed: true, deviceId: 'finished', observedAt }),
      report(episodeId, { positionSec: 100, durationSec: 3600, deviceId: 'behind', observedAt }),
    ]);
    const read = await app.inject({ method: 'GET', url: `/me/progress/${episodeId}`, headers: { origin: app.config.corsOrigins[0], cookie } });
    expect(read.json().data.progress).toMatchObject({ completed: true, deviceId: 'finished' });
  });
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
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    expect(read.json().data.progress).toMatchObject({ positionSec: 742, deviceId: 'phone' });
  });

  it('returns null for an episode never played', async () => {
    const read = await app.inject({
      method: 'GET',
      url: `/me/progress/${otherEpisodeId}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    expect(read.json().data.progress).toBeNull();
  });

  /**
   * The batch read, which is what lets a show page mark episodes as heard.
   *
   * Its contract is deliberately not "one row per id": episodes that have never
   * been touched are *absent* rather than present and null, because on an
   * archive page that is most of them and a row of nulls each is most of the
   * payload spent saying nothing. The client treats missing as untouched.
   */
  describe('in batches', () => {
    function listProgress(ids: string[], as: string = cookie) {
      return app.inject({
        method: 'GET',
        url: `/me/progress?ids=${ids.join(',')}`,
        headers: { origin: app.config.corsOrigins[0], cookie: as },
      });
    }

    it('refuses anonymous callers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/me/progress?ids=${episodeId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('answers for the episodes that have been played, and omits the rest', async () => {
      await report(episodeId, { positionSec: 900, durationSec: 3600, deviceId: 'phone' });

      const response = await listProgress([episodeId, otherEpisodeId]);
      const items = response.json().data.items;

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        episodeId,
        positionSec: 900,
        durationSec: 3600,
        completed: false,
      });
    });

    it('carries the completed flag, which is what draws a played mark', async () => {
      await report(episodeId, {
        positionSec: 3600,
        durationSec: 3600,
        completed: true,
        deviceId: 'phone',
      });

      const items = (await listProgress([episodeId])).json().data.items;
      expect(items[0].completed).toBe(true);
    });

    /** One listener's history must never reach another's show page. */
    it('is scoped to the caller', async () => {
      await report(episodeId, { positionSec: 900, durationSec: 3600, deviceId: 'phone' });

      const stranger = await signUp(`stranger-${Math.random().toString(36).slice(2)}@example.com`);
      const items = (await listProgress([episodeId], stranger)).json().data.items;

      expect(items).toEqual([]);
    });

    /*
      Rejected rather than truncated. Silently answering about the first hundred
      of two hundred episodes would render the rest as unplayed, which is worse
      than an error because it looks like data.
    */
    it('rejects more ids than a page could hold', async () => {
      const ids = Array.from(
        { length: 101 },
        (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      );

      expect((await listProgress(ids)).statusCode).toBe(400);
    });

    it('rejects an id that is not a uuid', async () => {
      expect((await listProgress(['not-a-uuid'])).statusCode).toBe(400);
    });

    it('does not collide with the single-episode route', async () => {
      await report(episodeId, { positionSec: 120, durationSec: 3600, deviceId: 'phone' });

      const single = await app.inject({
        method: 'GET',
        url: `/me/progress/${episodeId}`,
        headers: { origin: app.config.corsOrigins[0], cookie },
      });

      expect(single.json().data.progress).toMatchObject({ positionSec: 120 });
    });
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
      headers: { origin: app.config.corsOrigins[0], cookie },
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

  /**
   * The regression this guards: `duration_sec` is an integer column and
   * `HTMLMediaElement.duration` is a float on essentially every browser and
   * every file — 1882.122449 for a typical MP3, never a round number. Every
   * real report carried a value like that, and every one of them 500ed until
   * this was rounded the same way `positionSec` already is.
   */
  it('accepts a fractional duration, as every browser actually reports one', async () => {
    const response = await report(episodeId, {
      positionSec: 742,
      durationSec: 1882.122449,
      deviceId: 'phone',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.progress.durationSec).toBe(1882);
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
      headers: { origin: app.config.corsOrigins[0], cookie: other },
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
      headers: { origin: app.config.corsOrigins[0], cookie },
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
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    expect(response.json().data.items).toHaveLength(0);
  });
});

/**
 * The sibling of continue listening, and the reason it is a separate endpoint.
 *
 * Everything worth testing here is a difference from `/me/continue`: it keeps
 * what that one drops, and it says which is which.
 */
describe('recently played', () => {
  it('refuses anonymous callers', async () => {
    const response = await app.inject({ method: 'GET', url: '/me/history' });
    expect(response.statusCode).toBe(401);
  });

  it('keeps a finished episode, which is exactly what continue drops', async () => {
    await report(episodeId, {
      positionSec: 3600,
      durationSec: 3600,
      completed: true,
      deviceId: 'phone',
    });

    const history = await app.inject({
      method: 'GET',
      url: '/me/history',
      headers: { origin: app.config.corsOrigins[0], cookie },
    });
    const cont = await app.inject({
      method: 'GET',
      url: '/me/continue',
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    expect(history.json().data.items).toHaveLength(1);
    expect(cont.json().data.items).toHaveLength(0);
  });

  /**
   * The flag the row's second line is written from. Without it a finished
   * episode and an abandoned one are the same shape, and the section cannot
   * say "Finished" instead of a date.
   */
  it('says whether each episode was finished', async () => {
    await report(episodeId, {
      positionSec: 3600,
      durationSec: 3600,
      completed: true,
      deviceId: 'phone',
    });
    await report(otherEpisodeId, { positionSec: 90, durationSec: 1800, deviceId: 'phone' });

    const items = (
      await app.inject({ method: 'GET', url: '/me/history', headers: { origin: app.config.corsOrigins[0], cookie } })
    ).json().data.items;

    const byId = Object.fromEntries(
      items.map((item: { episode: { id: string }; completed: boolean }) => [
        item.episode.id,
        item.completed,
      ]),
    );

    expect(byId[episodeId]).toBe(true);
    expect(byId[otherEpisodeId]).toBe(false);
  });

  it('puts the most recently touched episode first', async () => {
    await report(episodeId, { positionSec: 100, durationSec: 3600, deviceId: 'phone' });
    await report(otherEpisodeId, { positionSec: 200, durationSec: 1800, deviceId: 'phone' });

    const items = (
      await app.inject({ method: 'GET', url: '/me/history', headers: { origin: app.config.corsOrigins[0], cookie } })
    ).json().data.items;

    expect(items[0].episode.id).toBe(otherEpisodeId);
    // Carries enough of its show to render a row without a second request.
    expect(items[0].podcastTitle).toBe('Playback Show');
  });

  it('honours the limit', async () => {
    await report(episodeId, { positionSec: 100, durationSec: 3600, deviceId: 'phone' });
    await report(otherEpisodeId, { positionSec: 200, durationSec: 1800, deviceId: 'phone' });

    const items = (
      await app.inject({ method: 'GET', url: '/me/history?limit=1', headers: { origin: app.config.corsOrigins[0], cookie } })
    ).json().data.items;

    expect(items).toHaveLength(1);
  });
});

describe('listening stats', () => {
  it('refuses anonymous callers', async () => {
    const response = await app.inject({ method: 'GET', url: '/me/stats' });
    expect(response.statusCode).toBe(401);
  });

  /**
   * The state the masthead has to handle without printing a row of zeroes at
   * somebody who just signed up.
   */
  it('reports an untouched account as empty rather than failing', async () => {
    const stats = (
      await app.inject({ method: 'GET', url: '/me/stats', headers: { origin: app.config.corsOrigins[0], cookie } })
    ).json().data;

    expect(stats).toMatchObject({
      listenedSec: 0,
      episodesStarted: 0,
      episodesFinished: 0,
      showCount: 0,
      topShow: null,
    });
  });

  it('adds up positions and counts finished episodes separately', async () => {
    await report(episodeId, {
      positionSec: 1200,
      durationSec: 3600,
      completed: true,
      deviceId: 'phone',
    });
    await report(otherEpisodeId, { positionSec: 300, durationSec: 1800, deviceId: 'phone' });

    const stats = (
      await app.inject({ method: 'GET', url: '/me/stats', headers: { origin: app.config.corsOrigins[0], cookie } })
    ).json().data;

    expect(stats.listenedSec).toBe(1500);
    expect(stats.episodesStarted).toBe(2);
    expect(stats.episodesFinished).toBe(1);
    // Both episodes belong to the same show, so this counts shows and not rows.
    expect(stats.showCount).toBe(1);
  });

  it('names the show with the most time against it', async () => {
    await report(episodeId, { positionSec: 900, durationSec: 3600, deviceId: 'phone' });

    const stats = (
      await app.inject({ method: 'GET', url: '/me/stats', headers: { origin: app.config.corsOrigins[0], cookie } })
    ).json().data;

    expect(stats.topShow).toMatchObject({ title: 'Playback Show', listenedSec: 900 });
  });

  /**
   * One listener's figures must never include another's — this is the same
   * boundary every `/me` route depends on, and the one that would be least
   * obvious if it broke.
   */
  it('counts only the caller', async () => {
    await report(episodeId, { positionSec: 900, durationSec: 3600, deviceId: 'phone' });

    const stranger = await signUp(`stranger-${Math.random().toString(36).slice(2)}@example.com`);
    const stats = (
      await app.inject({ method: 'GET', url: '/me/stats', headers: { origin: app.config.corsOrigins[0], cookie: stranger } })
    ).json().data;

    expect(stats.listenedSec).toBe(0);
    expect(stats.topShow).toBeNull();
  });
});

describe('queue', () => {
  function enqueue(id: string, playNext = false) {
    return app.inject({
      method: 'POST',
      url: '/me/queue',
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { episodeId: id, playNext },
    });
  }

  async function readQueue(): Promise<string[]> {
    const response = await app.inject({ method: 'GET', url: '/me/queue', headers: { origin: app.config.corsOrigins[0], cookie } });
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
      headers: { origin: app.config.corsOrigins[0], cookie },
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
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { episodeIds: ['00000000-0000-4000-8000-000000000000', episodeId] },
    });

    expect(response.json().data.reordered).toBe(1);
  });

  it('removes and clears', async () => {
    await enqueue(episodeId);
    await enqueue(otherEpisodeId);

    await app.inject({ method: 'DELETE', url: `/me/queue/${episodeId}`, headers: { origin: app.config.corsOrigins[0], cookie } });
    expect(await readQueue()).toEqual([otherEpisodeId]);

    await app.inject({ method: 'DELETE', url: '/me/queue', headers: { origin: app.config.corsOrigins[0], cookie } });
    expect(await readQueue()).toEqual([]);
  });

  it('404s when queueing an episode that does not exist', async () => {
    const response = await enqueue('00000000-0000-4000-8000-000000000000');
    expect(response.statusCode).toBe(404);
  });
});
