import {
  aiUsage,
  episodes,
  podcasts,
  transcriptionJobs,
  transcripts,
  userApiKeys,
  users,
  type Database,
} from '@cue/db';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ audio: vi.fn(), provider: vi.fn() }));
vi.mock('./audio.ts', () => ({ streamAudioChunks: mocks.audio }));
vi.mock('./groq.ts', () => ({ transcribe: mocks.provider }));
import { loadConfig } from '../config.ts';
import { createTestDatabase, type TestDatabase } from '../test/database.ts';
import { admit, claimNext, complete, jobFor, type ClaimedJob } from './queue.ts';
import { runJob, HEARTBEAT_MS, JOB_DEADLINE_MS } from './transcribe.ts';
import { encryptSecret } from './crypto.ts';

let harness: TestDatabase;
let db: Database;
let app: FastifyInstance;
let episodeId: string;
const encryption = 'isolated-lifecycle-encryption-secret';
const piece = { bytes: new Uint8Array([1]), startMs: 0, durationMs: 1000 };
const outcome = { status: 'ok', audioDurationMs: 1000, audioBytes: 100 };
beforeAll(async () => {
  harness = await createTestDatabase();
  db = harness as unknown as Database;
  app = {
    db,
    config: loadConfig({
      DATABASE_URL: 'pglite://memory',
      GROQ_API_KEY: 'operator-test-key',
      API_KEY_ENCRYPTION_SECRET: encryption,
    }),
    log: { warn: vi.fn(), info: vi.fn() },
  } as unknown as FastifyInstance;
  await db.insert(users).values({
    id: 'listener',
    name: 'Listener',
    email: 'lifecycle@isolated.test',
  });
  const [show] = await db
    .insert(podcasts)
    .values({ feedUrl: 'https://isolated.test/lifecycle', title: 'Lifecycle' })
    .returning();
  const [episode] = await db
    .insert(episodes)
    .values({
      podcastId: show!.id,
      guid: 'lifecycle',
      title: 'Lifecycle',
      audioUrl: 'https://isolated.test/audio',
      publishedAt: new Date(),
    })
    .returning();
  episodeId = episode!.id;
});
beforeEach(async () => {
  await db.delete(transcriptionJobs);
  await db.delete(transcripts);
  await db.delete(aiUsage);
  await db.delete(userApiKeys);
  mocks.audio.mockReset();
  mocks.provider.mockReset();
  mocks.provider.mockResolvedValue([{ startMs: 0, endMs: 1000, text: 'verified', words: null }]);
  mocks.audio.mockImplementation(async (_url, _size, upload) => {
    await upload(piece);
    return outcome;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await harness.$close();
});
async function setup(): Promise<ClaimedJob> {
  await admit(app, episodeId, 'listener');
  return (await claimNext(db))!;
}

describe('owned transcription execution', () => {
  it('commits generated segments and job removal together, retaining one successful charge', async () => {
    const lease = await setup();
    await runJob(app, lease);
    expect(await jobFor(db, episodeId)).toBeNull();
    expect(await db.select().from(aiUsage)).toMatchObject([{ count: 1 }]);
    expect((await db.select().from(transcripts))[0]).toMatchObject({
      status: 'ready',
      segments: [{ text: 'verified' }],
    });
    expect(mocks.provider.mock.calls[0]![0].signal).toBeInstanceOf(AbortSignal);
    expect(app.log.info).toHaveBeenLastCalledWith(
      expect.objectContaining({ episodeId, attempt: 1, fundingSource: 'operator' }),
      'transcription ready',
    );
  });
  it('retries temporary failures automatically and refunds only at exhaustion', async () => {
    mocks.audio.mockResolvedValue({
      status: 'error',
      permanent: false,
      detail: 'temporary socket failure',
    });
    const first = await setup();
    await runJob(app, first);
    expect(await jobFor(db, episodeId)).toMatchObject({
      status: 'queued',
      quotaState: 'reserved',
    });
    await runJob(app, (await claimNext(db))!);
    expect(await db.select().from(aiUsage)).toMatchObject([{ count: 1 }]);
    await runJob(app, (await claimNext(db))!);
    expect(await jobFor(db, episodeId)).toMatchObject({
      status: 'failed',
      quotaState: 'refunded',
      attempts: 3,
    });
    expect(await db.select().from(aiUsage)).toMatchObject([{ count: 0 }]);
  });
  it.each(['deleted', 'unreadable'])(
    'does not switch a %s BYOK key to operator funding',
    async (kind) => {
      await db.insert(userApiKeys).values({
        userId: 'listener',
        secret: encryptSecret('own-test-key', encryption),
        hint: 'test',
      });
      const lease = await setup();
      if (kind === 'deleted') await db.delete(userApiKeys);
      else await db.update(userApiKeys).set({ secret: 'unreadable' });
      await runJob(app, lease);
      expect(mocks.audio).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
      expect(await db.select().from(aiUsage)).toEqual([]);
      expect(await jobFor(db, episodeId)).toMatchObject({
        fundingSource: 'byok',
        quotaState: 'unmetered',
        status: 'failed',
      });
    },
  );
  it('continues periodic heartbeats during a stalled download', async () => {
    const lease = await setup();
    vi.useFakeTimers();
    const clearBeat = vi.spyOn(globalThis, 'clearInterval');
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((r) => {
      started = r;
    });
    const hold = new Promise<void>((r) => {
      release = r;
    });
    mocks.audio.mockImplementation(async (_url, _size, upload) => {
      started();
      await hold;
      await upload(piece);
      return outcome;
    });
    const work = runJob(app, lease);
    await entered;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 8);
    expect(await claimNext(db)).toBeNull();
    expect(await jobFor(db, episodeId)).toMatchObject({
      leaseToken: lease.leaseToken,
      status: 'running',
    });
    release();
    await work;
    expect(await jobFor(db, episodeId)).toBeNull();
    expect(clearBeat).toHaveBeenCalled();
  });
  it('aborts replaced work and rejects its late provider result', async () => {
    const lease = await setup();
    vi.useFakeTimers();
    let release!: (value: unknown) => void;
    let started!: () => void;
    const entered = new Promise<void>((r) => {
      started = r;
    });
    mocks.provider.mockImplementation(() => {
      started();
      return new Promise((r) => {
        release = r;
      });
    });
    const work = runJob(app, lease);
    await entered;
    await db
      .update(transcriptionJobs)
      .set({ heartbeatAt: sql`now() - interval '240 seconds'` })
      .where(eq(transcriptionJobs.episodeId, episodeId));
    const replacement = (await claimNext(db))!;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 1);
    await work;
    expect(mocks.provider.mock.calls[0]![0].signal.aborted).toBe(true);
    release([{ startMs: 0, endMs: 1000, text: 'stale A', words: null }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(await jobFor(db, episodeId)).toMatchObject({
      leaseToken: replacement.leaseToken,
      status: 'running',
      quotaState: 'reserved',
    });
    expect((await db.select().from(transcripts))[0]?.status).toBe('processing');
    expect(
      await complete(db, replacement, {
        segments: [
          {
            index: 0,
            startMs: 0,
            endMs: 1000,
            text: 'replacement',
            speaker: null,
          },
        ],
        audioDurationMs: 1000,
        audioBytes: 100,
      }),
    ).toBe(true);
    expect(await db.select().from(aiUsage)).toMatchObject([{ count: 1 }]);
  });
  it('cancels current work on shutdown and retains its reservation for retry', async () => {
    const lease = await setup();
    const shutdown = new AbortController();
    let started!: () => void;
    const entered = new Promise<void>((r) => {
      started = r;
    });
    mocks.audio.mockImplementation(() => {
      started();
      return new Promise(() => undefined);
    });
    const work = runJob(app, lease, { signal: shutdown.signal });
    await entered;
    shutdown.abort();
    await work;
    expect(await jobFor(db, episodeId)).toMatchObject({
      status: 'queued',
      quotaState: 'reserved',
    });
    expect(await db.select().from(aiUsage)).toMatchObject([{ count: 1 }]);
    expect((await claimNext(db))?.leaseToken).not.toBe(lease.leaseToken);
  });
  it('bounds the whole job and retains its reservation after a deadline', async () => {
    const lease = await setup();
    vi.useFakeTimers();
    let started!: () => void;
    const entered = new Promise<void>((r) => {
      started = r;
    });
    mocks.audio.mockImplementation(() => {
      started();
      return new Promise(() => undefined);
    });
    const work = runJob(app, lease);
    await entered;
    await vi.advanceTimersByTimeAsync(JOB_DEADLINE_MS);
    await work;
    expect(await jobFor(db, episodeId)).toMatchObject({
      status: 'queued',
      quotaState: 'reserved',
      attempts: 1,
    });
    expect(await db.select().from(aiUsage)).toMatchObject([{ count: 1 }]);
    expect((await db.select().from(transcripts))[0]?.status).toBe('processing');
  });
});
