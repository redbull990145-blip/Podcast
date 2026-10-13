import {
  aiUsage,
  episodes,
  podcasts,
  transcriptionJobs,
  transcripts,
  users,
  type Database,
} from '@cue/db';
import { eq, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  shape: vi.fn(),
  inserted: vi.fn(),
}));
vi.mock('../feed/fetch.ts', () => ({ fetchFeed: mocks.fetch }));
vi.mock('../ai/align/detect.ts', () => ({
  readAudioShape: mocks.shape,
  insertedAudio: mocks.inserted,
}));
vi.mock('../rate-limit.ts', () => ({ rateLimit: () => async () => undefined }));
import { admit, claimNext, complete, fail } from '../ai/queue.ts';
import { loadConfig } from '../config.ts';
import { createTestDatabase, type TestDatabase } from '../test/database.ts';
import { transcriptRoutes } from './transcripts.ts';

let harness: TestDatabase;
let app: FastifyInstance;
let db: Database;
let episodeId: string;
const generated = [
  {
    index: 0,
    startMs: 0,
    endMs: 1000,
    text: 'Generated answer',
    speaker: null,
  },
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const published = {
  status: 'ok',
  body: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nPublisher answer\n\n00:00:01.000 --> 00:00:02.000\nSecond answer\n',
};
beforeAll(async () => {
  harness = await createTestDatabase();
  db = harness as unknown as Database;
  await db.insert(users).values({
    id: 'transcript-owner',
    name: 'Isolated',
    email: 'transcript@isolated.test',
  });
  const [podcast] = await db
    .insert(podcasts)
    .values({ feedUrl: 'https://isolated.test/feed', title: 'Isolated' })
    .returning();
  const [episode] = await db
    .insert(episodes)
    .values({
      podcastId: podcast!.id,
      guid: 'transcript-race',
      title: 'Race',
      audioUrl: 'https://isolated.test/audio',
      transcriptUrl: 'https://isolated.test/transcript',
      publishedAt: new Date(),
    })
    .returning();
  episodeId = episode!.id;
  app = Fastify();
  app.decorate('db', db);
  app.decorate(
    'config',
    loadConfig({
      DATABASE_URL: 'pglite://memory',
      GROQ_API_KEY: 'isolated-test-key',
      AI_DAILY_QUOTA: '3',
    }),
  );
  transcriptRoutes(app);
  await app.ready();
});
beforeEach(async () => {
  await db.delete(transcriptionJobs);
  await db.delete(transcripts);
  await db.delete(aiUsage);
  mocks.fetch.mockReset();
  mocks.shape.mockReset().mockResolvedValue({ status: 'unreadable' });
  mocks.inserted.mockReset();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await app.close();
  await harness.$close();
});
const stored = async () =>
  (await db.select().from(transcripts).where(eq(transcripts.episodeId, episodeId)))[0];
async function heldFetch() {
  const started = deferred<void>();
  const response = deferred<typeof published | { status: string }>();
  mocks.fetch.mockImplementation(() => {
    started.resolve();
    return response.promise;
  });
  const request = app.inject({ url: `/episodes/${episodeId}/transcript` }).then((result) => result);
  await started.promise;
  return { request, response };
}
describe('publisher and generated transcript publication ownership', () => {
  it('rejects a publisher replacement within the same JavaScript millisecond', async () => {
    await db
      .insert(transcripts)
      .values({ episodeId, source: 'feed', status: 'failed', revision: 0 });
    await db.execute(
      sql`UPDATE ${transcripts} SET fetched_at = '2026-10-12T00:00:00.000123Z'::timestamptz WHERE episode_id = ${episodeId}`,
    );
    const held = await heldFetch();
    await db.execute(
      sql`UPDATE ${transcripts} SET fetched_at = '2026-10-12T00:00:00.000456Z'::timestamptz WHERE episode_id = ${episodeId}`,
    );
    held.response.resolve(published);
    await held.request;
    expect(await stored()).toMatchObject({
      status: 'failed',
      revision: 0,
      segments: [],
    });
  });
  it.each([{ status: 'ready' }, { revision: 1 }, { segments: generated }])(
    'rejects changed publisher fields with an identical timestamp: %j',
    async (change) => {
      await db
        .insert(transcripts)
        .values({ episodeId, source: 'feed', status: 'failed', revision: 0 });
      const held = await heldFetch();
      await db.update(transcripts).set(change).where(eq(transcripts.episodeId, episodeId));
      held.response.resolve(published);
      await held.request;
      expect(await stored()).toMatchObject(change);
      expect((await stored())!.segments).toEqual('segments' in change ? generated : []);
    },
  );
  it.each([published, { status: 'gone' }])(
    'preserves committed generated success when a held publisher fetch returns $status',
    async (outcome) => {
      const held = await heldFetch();
      await admit(app, episodeId, 'transcript-owner');
      const lease = (await claimNext(db))!;
      await complete(db, lease, {
        segments: generated,
        audioDurationMs: 1000,
        audioBytes: 100,
      });
      held.response.resolve(outcome);
      const response = await held.request;
      expect(response.statusCode).toBe(200);
      expect(response.json().data.transcript).toMatchObject({
        source: 'generated',
        status: 'ready',
        segments: generated,
      });
      expect(await stored()).toMatchObject({
        source: 'generated',
        status: 'ready',
        segments: generated,
      });
      expect(await db.select().from(aiUsage)).toMatchObject([{ count: 1 }]);
      expect(await db.select().from(transcriptionJobs)).toEqual([]);
    },
  );
  it('does not publish a feed success over admitted work or leave ready content after terminal refund', async () => {
    const held = await heldFetch();
    await admit(app, episodeId, 'transcript-owner');
    const lease = (await claimNext(db))!;
    held.response.resolve(published);
    await held.request;
    expect(await stored()).toMatchObject({
      source: 'generated',
      status: 'processing',
      segments: [],
    });
    await fail(db, lease, 'terminal', true);
    expect(await stored()).toMatchObject({
      source: 'generated',
      status: 'failed',
      segments: [],
    });
    expect(await db.select().from(aiUsage)).toMatchObject([{ count: 0 }]);
  });
  it('never re-fetches an expired generated failure from the publisher', async () => {
    await db.insert(transcripts).values({
      episodeId,
      source: 'generated',
      status: 'failed',
      detail: 'Generated failure',
      fetchedAt: new Date('2020-01-01'),
    });
    mocks.fetch.mockResolvedValue(published);
    const response = await app.inject({
      url: `/episodes/${episodeId}/transcript`,
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(await stored()).toMatchObject({
      source: 'generated',
      status: 'failed',
      detail: 'Generated failure',
    });
  });
  it('keeps a legacy job and its absent transcript quarantined during a publisher read', async () => {
    await db.insert(transcriptionJobs).values({
      episodeId,
      userId: 'transcript-owner',
      status: 'running',
      attempts: 3,
    });
    const before = await db.select().from(transcriptionJobs);
    mocks.fetch.mockResolvedValue(published);
    const response = await app.inject({
      url: `/episodes/${episodeId}/transcript`,
    });
    expect(response.statusCode).toBe(200);
    expect(await stored()).toBeUndefined();
    expect(await db.select().from(transcriptionJobs)).toEqual(before);
    expect(await db.select().from(aiUsage)).toEqual([]);
  });
  it('returns a newer publisher result instead of replacing it with an older fetch', async () => {
    const held = await heldFetch();
    const fresh = {
      episodeId,
      source: 'feed',
      status: 'ready',
      revision: 1,
      segments: generated,
    };
    await db.insert(transcripts).values(fresh);
    held.response.resolve({ status: 'gone' });
    const response = await held.request;
    expect(response.json().data.transcript).toMatchObject({
      source: 'feed',
      status: 'ready',
      segments: generated,
    });
    expect(await stored()).toMatchObject(fresh);
  });
  it('clears an alignment when an obsolete publisher transcript is replaced', async () => {
    await db.insert(transcripts).values({
      episodeId,
      source: 'feed',
      status: 'ready',
      revision: 0,
      segments: generated,
      alignment: {
        steps: [{ fromTranscriptMs: 0, offsetMs: 1000, bracketMs: [0, 0] }],
        anchors: [],
        confidence: 1,
        probes: 1,
        audioDurationMs: 2000,
        at: '2020-01-01',
      },
    });
    mocks.fetch.mockResolvedValue(published);
    const response = await app.inject({
      url: `/episodes/${episodeId}/transcript`,
    });
    expect(response.statusCode).toBe(200);
    expect(await stored()).toMatchObject({ alignment: null, revision: 1 });
  });
  it('does not attach a late measurement to a replacement publisher transcript', async () => {
    const shape = deferred<{ status: 'ok' }>();
    mocks.shape.mockReturnValue(shape.promise);
    mocks.inserted.mockReturnValue({ declaredDurationMs: 1234 });
    mocks.fetch.mockResolvedValue(published);
    await app.inject({ url: `/episodes/${episodeId}/transcript` });
    const first = (await stored())!;
    await db
      .update(transcripts)
      .set({
        segments: generated,
        fetchedAt: new Date(first.fetchedAt.getTime() + 1000),
        audioDurationMs: null,
      })
      .where(eq(transcripts.episodeId, episodeId));
    const update = vi.spyOn(db, 'update');
    shape.resolve({ status: 'ok' });
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(await stored()).toMatchObject({
      audioDurationMs: null,
      segments: generated,
    });
  });
});
