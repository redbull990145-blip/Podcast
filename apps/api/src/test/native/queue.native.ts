import {
  aiUsage,
  episodes,
  playbackProgress,
  podcasts,
  runMigrations,
  schema,
  transcriptionJobs,
  transcripts,
  userApiKeys,
  users,
  type Database,
} from '@cue/db';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import postgres from 'postgres';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync, realpathSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const workerMocks = vi.hoisted(() => ({ run: vi.fn() }));
const publisherMocks = vi.hoisted(() => ({ fetch: vi.fn(), shape: vi.fn() }));
vi.mock('../../ai/transcribe.ts', () => ({ runJob: workerMocks.run }));
vi.mock('../../feed/fetch.ts', () => ({ fetchFeed: publisherMocks.fetch }));
vi.mock('../../ai/align/detect.ts', () => ({
  readAudioShape: publisherMocks.shape,
  insertedAudio: () => ({ declaredDurationMs: 1234 }),
}));
vi.mock('../../rate-limit.ts', () => ({
  rateLimit: () => async () => undefined,
}));
import { startWorker } from '../../ai/worker.ts';
import { saveProgress } from '../../playback/progress.ts';
import { encryptSecret } from '../../ai/crypto.ts';
import { keyFor } from '../../ai/access.ts';
import { loadConfig } from '../../config.ts';
import {
  admit,
  claimNext,
  complete,
  fail,
  heartbeat,
  jobFor,
  MAX_ATTEMPTS,
  type ClaimedJob,
} from '../../ai/queue.ts';
import { assertJobSchema } from '../../ai/queue-schema.ts';
import { saveAlignment, type StoredAlignment } from '../../ai/align/run.ts';
import { transcriptRoutes } from '../../routes/transcripts.ts';

const root = resolve(import.meta.dirname, '../../../../..');
const cache = realpathSync(join(root, 'node_modules/.cache/phase25'));
const markerPath = process.env['PODCAST_NATIVE_TEST_MARKER'];
if (!markerPath) throw new Error('A disposable native-test owner marker is required');
const markerRelative = relative(cache, realpathSync(markerPath));
if (isAbsolute(markerRelative) || markerRelative.startsWith('..'))
  throw new Error('Invalid native-test marker location');
const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as {
  id: string;
  database: string;
  username: string;
  port: number;
  data: string;
  runnerPid: number;
  serverPid: number;
};
if (
  !/^[a-f0-9]{32}$/.test(marker.id) ||
  marker.database !== `podcast_native_${marker.id}` ||
  marker.username !== 'podcast_native_test' ||
  !Number.isInteger(marker.port)
)
  throw new Error('Invalid disposable native-test identity');
process.kill(marker.runnerPid, 0);
process.kill(marker.serverPid, 0);
const uri = (name = marker.database) =>
  `postgres://${marker.username}@127.0.0.1:${marker.port}/${name}`;
const control = postgres(uri(), { max: 4, prepare: false });
const clientA = postgres(uri(), { max: 5, prepare: false });
const clientB = postgres(uri(), { max: 5, prepare: false });
const dbA = drizzle(clientA, { schema }) as Database;
const dbB = drizzle(clientB, { schema }) as Database;
const makeApp = (db: Database, quota = 100) =>
  ({
    db,
    config: loadConfig({
      DATABASE_URL: uri(),
      GROQ_API_KEY: 'synthetic-operator-key',
      AI_DAILY_QUOTA: String(quota),
    }),
  }) as FastifyInstance;
const appA = makeApp(dbA);
const appB = makeApp(dbB);
let episodeIds: string[];
const result = {
  segments: [
    {
      index: 0,
      startMs: 0,
      endMs: 1000,
      text: 'Native verified',
      speaker: null,
    },
  ],
  audioDurationMs: 1000,
  audioBytes: 100,
};
beforeAll(async () => {
  const [server] =
    await control`SELECT current_setting('server_version_num')::int AS version, current_setting('data_directory') AS directory`;
  expect(server!['version']).toBeGreaterThanOrEqual(170000);
  expect(server!['version']).toBeLessThan(180000);
  expect(realpathSync(server!['directory'])).toBe(realpathSync(marker.data));
  await runMigrations(dbA);
  await assertJobSchema(dbA);
  await dbA.insert(users).values([
    { id: 'native-A', name: 'A', email: 'native-a@isolated.test' },
    { id: 'native-B', name: 'B', email: 'native-b@isolated.test' },
  ]);
  const [show] = await dbA
    .insert(podcasts)
    .values({ feedUrl: 'https://isolated.test/native', title: 'Native' })
    .returning();
  episodeIds = (
    await dbA
      .insert(episodes)
      .values(
        Array.from({ length: 40 }, (_, i) => ({
          podcastId: show!.id,
          guid: `native-${i}`,
          title: `Native ${i}`,
          audioUrl: 'https://isolated.test/audio',
          publishedAt: new Date(),
        })),
      )
      .returning()
  ).map((row) => row.id);
});
beforeEach(async () => {
  await dbA.delete(transcriptionJobs);
  await dbA.delete(transcripts);
  await dbA.delete(aiUsage);
  await dbA.delete(userApiKeys);
  await dbA.delete(playbackProgress);
  workerMocks.run.mockReset();
  publisherMocks.fetch.mockReset();
  publisherMocks.shape.mockReset().mockResolvedValue({ status: 'unreadable' });
});
afterAll(async () => {
  await Promise.all([
    clientA.end({ timeout: 5 }),
    clientB.end({ timeout: 5 }),
    control.end({ timeout: 5 }),
  ]);
});
async function lockWaiters(count: number) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const [row] =
      await control`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (row!['n'] >= count) return;
    await new Promise((yes) => setTimeout(yes, 10));
  }
  throw new Error(`Expected ${count} native lock waiters`);
}
async function blockedEpisode<T>(
  id: string,
  launch: () => Promise<T>,
  whileHeld?: (tx: postgres.TransactionSql) => Promise<void>,
  waiters = 2,
): Promise<T> {
  let pending!: Promise<T>;
  await control.begin(async (tx) => {
    await tx`SELECT id FROM episodes WHERE id = ${id} FOR UPDATE`;
    pending = launch();
    // Attach immediately so an unexpected failure cannot become unhandled.
    void pending.catch(() => undefined);
    await lockWaiters(waiters);
    await whileHeld?.(tx);
  });
  return pending;
}
async function expired(episodeId: string) {
  await control`UPDATE transcription_jobs SET heartbeat_at = now() - interval '240 seconds' WHERE episode_id = ${episodeId}`;
}
async function lease(db = dbA): Promise<ClaimedJob> {
  const found = await claimNext(db);
  expect(found).not.toBeNull();
  return found!;
}
const usage = () => dbA.select().from(aiUsage);
const transcript = async (id = episodeIds[0]!) =>
  (await dbA.select().from(transcripts).where(eq(transcripts.episodeId, id)))[0];

describe('native PostgreSQL 17 queue concurrency, with independent connections', () => {
  it('fences a held publisher fetch against a native sub-millisecond replacement', async () => {
    const id = episodeIds[0]!;
    await dbA
      .update(episodes)
      .set({ transcriptUrl: 'https://isolated.test/transcript' })
      .where(eq(episodes.id, id));
    await control`INSERT INTO transcripts(episode_id,source,status,revision,fetched_at) VALUES (${id},'feed','failed',0,'2026-10-12T00:00:00.000123Z')`;
    const server = Fastify();
    server.decorate('db', dbA);
    let release!: (value: { status: string; body: string }) => void;
    let announce!: () => void;
    const started = new Promise<void>((yes) => {
      announce = yes;
    });
    publisherMocks.fetch.mockImplementation(() => {
      announce();
      return new Promise((yes) => {
        release = yes;
      });
    });
    transcriptRoutes(server);
    try {
      const request = server
        .inject({ url: `/episodes/${id}/transcript` })
        .then((response) => response);
      await started;
      await control`UPDATE transcripts SET fetched_at='2026-10-12T00:00:00.000456Z' WHERE episode_id=${id}`;
      release({
        status: 'ok',
        body: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nNew cues\n',
      });
      expect((await request).statusCode).toBe(200);
      expect(await transcript()).toMatchObject({
        source: 'feed',
        status: 'failed',
        revision: 0,
        segments: [],
      });
    } finally {
      await server.close();
    }
  });
  it('retains the inserted native row version for a late audio measurement', async () => {
    const id = episodeIds[0]!;
    await dbA
      .update(episodes)
      .set({
        transcriptUrl: 'https://isolated.test/transcript',
        audioLengthBytes: 123,
      })
      .where(eq(episodes.id, id));
    const server = Fastify();
    server.decorate('db', dbA);
    let release!: (value: { status: string }) => void;
    publisherMocks.shape.mockImplementation(
      () =>
        new Promise((yes) => {
          release = yes;
        }),
    );
    publisherMocks.fetch.mockResolvedValue({
      status: 'ok',
      body: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nNew cues\n\n00:00:01.000 --> 00:00:02.000\nSecond cues\n',
    });
    transcriptRoutes(server);
    try {
      expect((await server.inject({ url: `/episodes/${id}/transcript` })).statusCode).toBe(200);
      expect((await transcript())!.audioDurationMs).toBeNull();
      release({ status: 'ok' });
      await vi.waitFor(async () =>
        expect(await transcript()).toMatchObject({
          audioDurationMs: 1234,
          audioBytes: 123,
        }),
      );
    } finally {
      await server.close();
    }
  });
  it('preserves historical microseconds and rejects a sub-millisecond alignment replacement', async () => {
    const id = episodeIds[0]!;
    await control`INSERT INTO transcripts(episode_id,source,status,revision,segments,fetched_at) VALUES (${id},'feed','ready',1,${control.json(result.segments)},'2026-10-12T00:00:00.000123Z')`;
    const [observed] = await dbA
      .select({
        ...getTableColumns(transcripts),
        fetchedAtVersion: sql<string>`to_char(${transcripts.fetchedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(transcripts)
      .where(eq(transcripts.episodeId, id));
    expect(observed!.fetchedAtVersion).toBe('2026-10-12T00:00:00.000123Z');
    const alignment: StoredAlignment = {
      steps: [{ fromTranscriptMs: 0, offsetMs: 1000, bracketMs: [0, 0] }],
      anchors: [],
      confidence: 1,
      probes: 3,
      audioDurationMs: 5000,
      at: '2026-10-12T00:00:00Z',
    };
    expect(await saveAlignment(appA, observed!, alignment)).toBe(true);
    await control`UPDATE transcripts SET alignment=NULL,fetched_at='2026-10-12T00:00:00.000456Z' WHERE episode_id=${id}`;
    expect((await transcript())!.fetchedAt.getTime()).toBe(observed!.fetchedAt.getTime());
    expect(await saveAlignment(appB, observed!, alignment)).toBe(false);
    expect((await transcript())!.alignment).toBeNull();
  });
  it('repeats duplicate/account admission races behind deterministic row-lock barriers', async () => {
    for (let i = 0; i < 15; i++) {
      await dbA.delete(transcriptionJobs);
      await dbA.delete(transcripts);
      await dbA.delete(aiUsage);
      const outcomes = await blockedEpisode(episodeIds[0]!, () =>
        Promise.all([
          admit(appA, episodeIds[0]!, 'native-A'),
          admit(appB, episodeIds[0]!, 'native-B'),
        ]),
      );
      expect(outcomes.filter((outcome) => outcome.started)).toHaveLength(1);
      const job = await jobFor(dbA, episodeIds[0]!);
      expect(await usage()).toMatchObject([{ userId: job!.userId, day: job!.quotaDay, count: 1 }]);
    }
  });
  it('allows only one quota reservation for two different episodes at allowance one', async () => {
    await control`INSERT INTO ai_usage(user_id, day, count) VALUES ('native-A', (now() AT TIME ZONE 'UTC')::date, 0)`;
    let pending!: Promise<PromiseSettledResult<{ started: boolean; detail: string | null }>[]>;
    await control.begin(async (tx) => {
      await tx`SELECT * FROM ai_usage WHERE user_id = 'native-A' FOR UPDATE`;
      pending = Promise.allSettled([
        admit(makeApp(dbA, 1), episodeIds[0]!, 'native-A'),
        admit(makeApp(dbB, 1), episodeIds[1]!, 'native-A'),
      ]);
      await lockWaiters(2);
    });
    expect((await pending).filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(await usage()).toMatchObject([{ count: 1 }]);
    expect(await dbA.select().from(transcriptionJobs)).toHaveLength(1);
  });
  it('observes a ready transcript committed while admission was waiting', async () => {
    const outcomes = await blockedEpisode(
      episodeIds[0]!,
      () => Promise.all([admit(appA, episodeIds[0]!, 'native-A')]),
      async (tx) => {
        await tx`INSERT INTO transcripts(episode_id,source,status,segments) VALUES (${episodeIds[0]!}, 'feed', 'ready', ${tx.json(result.segments)})`;
      },
      1,
    );
    expect(outcomes[0]!.started).toBe(false);
    expect(await usage()).toEqual([]);
    expect(await dbA.select().from(transcriptionJobs)).toEqual([]);
  });
  it('distributes unlocked jobs to simultaneous workers using SKIP LOCKED', async () => {
    for (const id of episodeIds.slice(0, 3)) await admit(appA, id, 'native-A');
    let claimed!: (ClaimedJob | null)[];
    await control.begin(async (tx) => {
      await tx`SELECT id FROM episodes WHERE id = ${episodeIds[0]!} FOR UPDATE`;
      claimed = await Promise.all([claimNext(dbA), claimNext(dbB)]);
    });
    expect(claimed.every(Boolean)).toBe(true);
    expect(new Set(claimed.map((row) => row!.episodeId)).size).toBe(2);
    expect(claimed.map((row) => row!.episodeId)).not.toContain(episodeIds[0]);
  });
  it('claims work beyond the first candidate page when 32 older episode rows are locked', async () => {
    for (const id of episodeIds) await admit(appA, id, 'native-A');
    // Equal timestamps at native microsecond precision exercise the tie breaker.
    await control`UPDATE transcription_jobs SET created_at = '2024-01-01T00:00:00.000123Z'`;
    const ordered =
      await control`SELECT episode_id FROM transcription_jobs ORDER BY created_at,episode_id`;
    const orderedIds = ordered.map((row) => row['episode_id'] as string);
    const blocked = orderedIds.slice(0, 32);
    await control.begin(async (tx) => {
      await tx`SELECT id FROM episodes WHERE id = ANY(${tx.array(blocked)}::uuid[]) FOR UPDATE`;
      const claimed = await claimNext(dbB);
      expect(claimed).not.toBeNull();
      expect(orderedIds.slice(32)).toContain(claimed!.episodeId);
    });
  });
  it('keeps retry and refund on the original account and UTC day', async () => {
    await admit(appA, episodeIds[0]!, 'native-A');
    await control`UPDATE transcription_jobs SET quota_day='2020-01-01'`;
    await control`UPDATE ai_usage SET day='2020-01-01' WHERE user_id='native-A'`;
    await dbA.insert(aiUsage).values({ userId: 'native-B', day: '2020-01-01', count: 9 });
    const first = await lease();
    await fail(dbA, first, 'transient');
    expect((await admit(appB, first.episodeId, 'native-B')).started).toBe(false);
    const retry = await lease(dbB);
    expect(retry).toMatchObject({ userId: 'native-A', quotaDay: '2020-01-01' });
    expect(
      (await fail(dbA, { ...retry, userId: 'native-B', quotaDay: '2099-01-01' }, 'terminal', true))
        .owned,
    ).toBe(true);
    expect(await usage()).toEqual(
      expect.arrayContaining([
        { userId: 'native-A', day: '2020-01-01', count: 0 },
        { userId: 'native-B', day: '2020-01-01', count: 9 },
      ]),
    );
  });
  it('never switches removed or unreadable BYOK jobs to operator funding', async () => {
    const encryption = 'native-synthetic-encryption-secret';
    const byokApp = {
      db: dbA,
      config: loadConfig({
        DATABASE_URL: uri(),
        GROQ_API_KEY: 'synthetic-operator-key',
        API_KEY_ENCRYPTION_SECRET: encryption,
      }),
    } as FastifyInstance;
    for (const unreadable of [false, true]) {
      await dbA.delete(transcriptionJobs);
      await dbA.delete(transcripts);
      await dbA.insert(userApiKeys).values({
        userId: 'native-A',
        provider: 'groq',
        secret: encryptSecret('synthetic-owned-key', encryption),
        hint: 'test',
      });
      await admit(byokApp, episodeIds[0]!, 'native-A');
      const current = await lease();
      if (unreadable)
        await control`UPDATE user_api_keys SET secret='unreadable' WHERE user_id='native-A'`;
      else await dbA.delete(userApiKeys);
      await expect(keyFor(byokApp, 'native-A', current.fundingSource)).rejects.toBeDefined();
      expect((await fail(dbA, current, 'key unavailable', true)).owned).toBe(true);
      expect(await usage()).toEqual([]);
      expect(await jobFor(dbA, current.episodeId)).toMatchObject({
        fundingSource: 'byok',
        quotaState: 'unmetered',
      });
      await dbA.delete(userApiKeys);
    }
  });
  it('rolls admission back before reporting a reservation and emits only safe committed metadata', async () => {
    const info = vi.fn();
    const loggingApp = { ...appA, log: { info } } as unknown as FastifyInstance;
    await control`CREATE FUNCTION native_reject_admission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated admission failure'; END $$`;
    await control`CREATE TRIGGER native_reject_admission BEFORE INSERT ON transcription_jobs FOR EACH ROW EXECUTE FUNCTION native_reject_admission()`;
    try {
      await expect(admit(loggingApp, episodeIds[0]!, 'native-A')).rejects.toBeDefined();
    } finally {
      await control`DROP TRIGGER native_reject_admission ON transcription_jobs`;
      await control`DROP FUNCTION native_reject_admission()`;
    }
    expect(info).not.toHaveBeenCalled();
    expect(await usage()).toEqual([]);
    expect(await transcript()).toBeUndefined();
    await admit(loggingApp, episodeIds[0]!, 'native-A');
    expect(info).toHaveBeenCalledExactlyOnceWith(
      {
        episodeId: episodeIds[0],
        attempts: 0,
        fundingSource: 'operator',
        quotaState: 'reserved',
      },
      'transcription admission reserved',
    );
    await admit(loggingApp, episodeIds[0]!, 'native-B');
    expect(info).toHaveBeenCalledOnce();
  });
  it('rejects heartbeat lock waits within its owned transaction and preserves progress', async () => {
    await admit(appA, episodeIds[0]!, 'native-A');
    const current = await lease();
    await control.begin(async (tx) => {
      await tx`SELECT * FROM transcription_jobs WHERE episode_id=${current.episodeId} FOR UPDATE`;
      const began = Date.now();
      await expect(
        heartbeat(dbB, current, { stage: 'saving', done: 1, total: 1 }),
      ).rejects.toMatchObject({ cause: { code: '55P03' } });
      expect(Date.now() - began).toBeLessThan(12_000);
    });
    expect(await jobFor(dbA, current.episodeId)).toMatchObject({
      stage: null,
      done: 0,
      leaseToken: current.leaseToken,
    });
    expect(await heartbeat(dbB, current, { stage: 'saving', done: 1, total: 1 })).toBe(true);
    expect((await clientB`SHOW lock_timeout`)[0]!['lock_timeout']).toBe('0');
  });
  it('cancels a blocked completion statement and rolls back the saved transcript atomically', async () => {
    await admit(appA, episodeIds[0]!, 'native-A');
    const current = await lease();
    // Pause deletion after transcript upsert, inside the actual completion transaction.
    await control`CREATE FUNCTION native_slow_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(35); RETURN OLD; END $$`;
    await control`CREATE TRIGGER native_slow_completion BEFORE DELETE ON transcription_jobs FOR EACH ROW EXECUTE FUNCTION native_slow_completion()`;
    try {
      const began = Date.now();
      await expect(complete(dbB, current, result)).rejects.toMatchObject({
        cause: { code: '57014' },
      });
      expect(Date.now() - began).toBeLessThan(40_000);
    } finally {
      await control`DROP TRIGGER native_slow_completion ON transcription_jobs`;
      await control`DROP FUNCTION native_slow_completion()`;
    }
    expect(await transcript()).toMatchObject({
      status: 'processing',
      segments: [],
    });
    expect(await jobFor(dbA, current.episodeId)).toMatchObject({
      status: 'running',
      leaseToken: current.leaseToken,
      quotaState: 'reserved',
    });
    expect(await usage()).toMatchObject([{ count: 1 }]);
    expect(await complete(dbA, current, result)).toBe(true);
    expect((await clientB`SHOW statement_timeout`)[0]!['statement_timeout']).toBe('0');
  });
  it('rolls refund and job state back when the transcript settlement fails', async () => {
    await admit(appA, episodeIds[0]!, 'native-A');
    const current = await lease();
    await control`CREATE FUNCTION native_reject_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated settlement failure'; END $$`;
    await control`CREATE TRIGGER native_reject_settlement BEFORE UPDATE ON transcripts FOR EACH ROW EXECUTE FUNCTION native_reject_settlement()`;
    try {
      await expect(fail(dbB, current, 'terminal', true)).rejects.toBeDefined();
    } finally {
      await control`DROP TRIGGER native_reject_settlement ON transcripts`;
      await control`DROP FUNCTION native_reject_settlement()`;
    }
    expect(await usage()).toMatchObject([{ count: 1 }]);
    expect(await jobFor(dbA, current.episodeId)).toMatchObject({
      status: 'running',
      quotaState: 'reserved',
      leaseToken: current.leaseToken,
    });
    expect(await transcript()).toMatchObject({ status: 'processing' });
    expect((await fail(dbA, current, 'retry settlement', true)).owned).toBe(true);
    expect(await usage()).toMatchObject([{ count: 0 }]);
  });
  it('stops the worker after a real blocked cancellation settlement and recovers its reservation', async () => {
    await admit(appA, episodeIds[0]!, 'native-A');
    let announced!: (job: ClaimedJob) => void;
    const started = new Promise<ClaimedJob>((yes) => {
      announced = yes;
    });
    workerMocks.run.mockImplementation(
      async (_app: FastifyInstance, job: ClaimedJob, options: { signal: AbortSignal }) => {
        announced(job);
        await new Promise<void>((yes) =>
          options.signal.addEventListener('abort', () => yes(), { once: true }),
        );
        await fail(dbB, job, 'worker shutdown', true);
      },
    );
    const errors = vi.fn();
    const worker = startWorker({
      ...appA,
      log: { info: vi.fn(), error: errors },
    } as unknown as FastifyInstance);
    const current = await started;
    try {
      await control.begin(async (tx) => {
        await tx`SELECT id FROM episodes WHERE id=${current.episodeId} FOR UPDATE`;
        const began = Date.now();
        await worker.stop();
        expect(Date.now() - began).toBeLessThan(12_000);
      });
    } finally {
      await worker.stop();
    }
    expect(errors).toHaveBeenCalledWith(
      expect.anything(),
      'could not settle a transcription attempt',
    );
    expect(await jobFor(dbA, current.episodeId)).toMatchObject({
      status: 'running',
      quotaState: 'reserved',
      leaseToken: current.leaseToken,
    });
    expect(await usage()).toMatchObject([{ count: 1 }]);
    await expired(current.episodeId);
    const replacement = await lease();
    expect(replacement.leaseToken).not.toBe(current.leaseToken);
    expect((await fail(dbB, current, 'old shutdown', true)).owned).toBe(false);
    await fail(dbA, replacement, 'replacement terminal', true);
    expect(await usage()).toMatchObject([{ count: 0 }]);
  });
  it('serializes concurrent first playback writes, tied timestamps, and out-of-order device updates', async () => {
    const base = {
      durationSec: 1000,
      completed: false,
      updatedAt: 1_700_000_000_000,
    };
    const further = { ...base, positionSec: 800, deviceId: 'phone' };
    const behind = { ...base, positionSec: 100, deviceId: 'laptop' };
    for (let i = 0; i < 15; i++) {
      await dbA.delete(playbackProgress);
      await blockedEpisode(episodeIds[0]!, () =>
        Promise.all([
          saveProgress(dbA, 'native-A', episodeIds[0]!, further),
          saveProgress(dbB, 'native-A', episodeIds[0]!, behind),
        ]),
      );
      expect(await dbA.select().from(playbackProgress)).toMatchObject([
        {
          positionSec: 800,
          deviceId: 'phone',
          updatedAt: new Date(base.updatedAt),
        },
      ]);
    }
    const newer = {
      ...behind,
      positionSec: 50,
      updatedAt: base.updatedAt + 120_000,
    };
    await saveProgress(dbB, 'native-A', episodeIds[0]!, newer);
    expect(await saveProgress(dbA, 'native-A', episodeIds[0]!, further)).toEqual(newer);
    const finished = { ...newer, positionSec: 1000, completed: true };
    await saveProgress(dbA, 'native-A', episodeIds[0]!, finished);
    expect(await saveProgress(dbB, 'native-A', episodeIds[0]!, newer)).toEqual(finished);
    await saveProgress(dbB, 'native-B', episodeIds[0]!, behind);
    expect(await dbA.select().from(playbackProgress)).toHaveLength(2);
  });
  it('fences stale A-B-A leases and crash recovery through all attempts', async () => {
    await admit(appA, episodeIds[0]!, 'native-A');
    const first = await lease();
    await expired(first.episodeId);
    const second = await lease(dbB);
    await expired(first.episodeId);
    const third = await lease();
    for (const old of [first, second]) {
      expect(await heartbeat(dbB, old, { stage: 'saving', done: 9, total: 9 })).toBe(false);
      expect(await complete(dbB, old, result)).toBe(false);
      expect((await fail(dbB, old, 'old failure', true)).owned).toBe(false);
    }
    expect(await complete(dbA, third, result)).toBe(true);
    expect((await transcript())?.status).toBe('ready');
    expect(await usage()).toMatchObject([{ count: 1 }]);
  });
  it('repeats simultaneous completion/failure and refund races without mixed settlement', async () => {
    for (let i = 0; i < 15; i++) {
      await dbA.delete(transcriptionJobs);
      await dbA.delete(transcripts);
      await dbA.delete(aiUsage);
      await admit(appA, episodeIds[0]!, 'native-A');
      const current = await lease();
      const [saved, failed] = await blockedEpisode(current.episodeId, () =>
        Promise.all([complete(dbA, current, result), fail(dbB, current, 'terminal', true)]),
      );
      if (saved) {
        expect(failed.owned).toBe(false);
        expect((await transcript())?.status).toBe('ready');
        expect(await usage()).toMatchObject([{ count: 1 }]);
      } else {
        expect(failed.owned).toBe(true);
        expect((await transcript())?.status).toBe('failed');
        expect(await usage()).toMatchObject([{ count: 0 }]);
      }
    }
    await dbA.delete(transcriptionJobs);
    await dbA.delete(transcripts);
    await dbA.delete(aiUsage);
    await admit(appA, episodeIds[0]!, 'native-A');
    const current = await lease();
    const settlers = await blockedEpisode(current.episodeId, () =>
      Promise.all([fail(dbA, current, 'terminal', true), fail(dbB, current, 'terminal', true)]),
    );
    expect(settlers.filter((settler) => settler.owned)).toHaveLength(1);
    expect(await usage()).toMatchObject([{ count: 0 }]);
  });
  it('settles exhausted crashes once while manual admission races recovery', async () => {
    await admit(appA, episodeIds[0]!, 'native-A');
    let current!: ClaimedJob;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      current = await lease();
      await expired(current.episodeId);
    }
    const [firstClaim, secondClaim, admission] = await Promise.all([
      claimNext(dbA),
      claimNext(dbB),
      admit(appA, current.episodeId, 'native-B'),
    ]);
    let job = await jobFor(dbA, current.episodeId);
    const claims = [firstClaim, secondClaim].filter((claimed) => claimed !== null);
    if (!admission.started && job!.status === 'running') {
      // Admission can briefly hold the episode while both SKIP LOCKED scans
      // skip it. The next unlocked worker poll must settle that exhausted lease.
      expect(claims).toEqual([]);
      expect(job).toMatchObject({
        userId: 'native-A',
        attempts: MAX_ATTEMPTS,
        quotaState: 'reserved',
        leaseToken: current.leaseToken,
      });
      expect(await claimNext(dbA)).toBeNull();
      job = await jobFor(dbA, current.episodeId);
    }
    // Recovery can commit before B's admission, and another claimant may then
    // legitimately take B's replacement. Assert that exact ownership transition.
    if (admission.started) {
      expect(job).toMatchObject({
        userId: 'native-B',
        quotaState: 'reserved',
        status: claims.length ? 'running' : 'queued',
        attempts: claims.length ? 1 : 0,
      });
      expect(claims.length).toBeLessThanOrEqual(1);
      if (claims.length) {
        expect(claims[0]).toMatchObject({ userId: 'native-B', leaseToken: job!.leaseToken });
        expect(claims[0]!.leaseToken).not.toBe(current.leaseToken);
      }
      expect(await usage()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: 'native-A', count: 0 }),
          expect.objectContaining({ userId: 'native-B', count: 1 }),
        ]),
      );
    } else {
      expect(job).toMatchObject({ userId: 'native-A', status: 'failed', quotaState: 'refunded' });
      expect(claims).toEqual([]);
      expect(await usage()).toMatchObject([{ userId: 'native-A', count: 0 }]);
    }
    expect((await fail(dbA, current, 'stale exhausted', true)).owned).toBe(false);
    expect(await jobFor(dbA, current.episodeId)).toEqual(job);
  });
  it('repeats account deletion versus terminal settlement without crediting another account', async () => {
    for (let i = 0; i < 15; i++) {
      await dbA.delete(transcriptionJobs);
      await dbA.delete(transcripts);
      await dbA.delete(aiUsage);
      const owner = `native-deleted-${i}`;
      await dbA.insert(users).values({
        id: owner,
        name: 'Deleted',
        email: `${owner}@isolated.test`,
      });
      await admit(appA, episodeIds[0]!, owner);
      const current = await lease();
      await dbA.insert(aiUsage).values({ userId: 'native-B', day: current.quotaDay!, count: 1 });
      const outcomes = await Promise.allSettled([
        fail(dbA, current, 'terminal', true),
        dbB.delete(users).where(eq(users.id, owner)),
      ]);
      // Native deadlocks are surfaced, never counted as successful settlement.
      expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
      expect(await usage()).toEqual([{ userId: 'native-B', day: current.quotaDay, count: 1 }]);
      expect(await jobFor(dbA, current.episodeId)).toMatchObject({
        userId: null,
        status: 'failed',
      });
    }
  });
  it('rolls back partial settlement on a server statement timeout and restores settings', async () => {
    await control`CREATE TABLE native_timeout_probe(value integer)`;
    await expect(
      control.begin(async (tx) => {
        await tx`SET LOCAL statement_timeout = '100ms'`;
        await tx`INSERT INTO native_timeout_probe VALUES (1)`;
        await tx`SELECT pg_sleep(1)`;
      }),
    ).rejects.toMatchObject({ code: '57014' });
    expect(await control`SELECT * FROM native_timeout_probe`).toEqual([]);
    expect((await control`SHOW statement_timeout`)[0]!['statement_timeout']).toBe('0');
  });
  it('surfaces a native deadlock and rolls back exactly one transaction', async () => {
    await control`CREATE TABLE native_deadlock_probe(id integer PRIMARY KEY, value integer NOT NULL)`;
    await control`INSERT INTO native_deadlock_probe VALUES (1,0),(2,0)`;
    let arrivals = 0;
    let open!: () => void;
    const both = new Promise<void>((yes) => {
      open = yes;
    });
    const cross = (client: postgres.Sql, first: number, second: number) =>
      client.begin(async (tx) => {
        await tx`UPDATE native_deadlock_probe SET value = value + 1 WHERE id = ${first}`;
        if (++arrivals === 2) open();
        await both;
        await tx`UPDATE native_deadlock_probe SET value = value + 1 WHERE id = ${second}`;
      });
    const outcomes = await Promise.allSettled([cross(clientA, 1, 2), cross(clientB, 2, 1)]);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      reason: { code: '40P01' },
    });
    expect(await control`SELECT value FROM native_deadlock_probe ORDER BY id`).toEqual([
      { value: 1 },
      { value: 1 },
    ]);
  });
});

describe('exact migration and rollback on owned native PostgreSQL 17 databases', () => {
  it('preserves populated legacy rows, enforces constraints, and proves rollback metadata loss', async () => {
    const name = `podcast_native_${randomUUID().replaceAll('-', '')}_migration`;
    await control.unsafe(`CREATE DATABASE "${name}"`);
    const client = postgres(uri(name), { max: 1, prepare: false });
    const locking = postgres(uri(name), { max: 1, prepare: false });
    const folder = join(root, 'packages/db/migrations');
    try {
      for (const file of readdirSync(folder)
        .filter((name) => name.endsWith('.sql') && name < '0016')
        .sort()) {
        await client.begin(async (tx) => {
          for (const statement of readFileSync(join(folder, file), 'utf8').split(
            '--> statement-breakpoint',
          ))
            if (statement.trim()) await tx.unsafe(statement);
        });
      }
      await client`INSERT INTO users(id,name,email) VALUES ('native-legacy','Legacy','native-legacy@isolated.test')`;
      await client`INSERT INTO ai_usage(user_id,day,count) VALUES ('native-legacy','2020-01-01',7)`;
      const [show] =
        await client`INSERT INTO podcasts(feed_url,title) VALUES ('https://isolated.test/legacy','Legacy') RETURNING id`;
      const [episode] =
        await client`INSERT INTO episodes(podcast_id,guid,title,audio_url,published_at) VALUES (${show!['id']},'legacy','Legacy','https://isolated.test/audio',now()) RETURNING id`;
      await client`INSERT INTO transcription_jobs(episode_id,user_id,quota_day,status,attempts) VALUES (${episode!['id']},'native-legacy','2020-01-01','running',3)`;
      const before = await client`SELECT row_to_json(t) AS snapshot FROM transcription_jobs t`;
      const forward = readFileSync(join(root, 'docs/remediation/stage-2-forward.sql'), 'utf8');
      const rollback = readFileSync(join(root, 'docs/remediation/stage-2-rollback.sql'), 'utf8');
      await client.unsafe(forward);
      await assertJobSchema(drizzle(client, { schema }) as Database);
      expect(
        (await client`SELECT funding_source,quota_state,lease_token FROM transcription_jobs`)[0],
      ).toEqual({
        funding_source: 'legacy',
        quota_state: 'legacy',
        lease_token: null,
      });
      await expect(
        client`UPDATE transcription_jobs SET funding_source='operator',quota_state='reserved',quota_day=NULL`,
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        client`UPDATE transcription_jobs SET funding_source='operator',quota_state='reserved',lease_token=NULL`,
      ).rejects.toMatchObject({ code: '23514' });
      await client.unsafe(rollback);
      expect(await client`SELECT row_to_json(t) AS snapshot FROM transcription_jobs t`).toEqual(
        before,
      );
      expect(await client`SELECT count FROM ai_usage`).toEqual([{ count: 7 }]);
      // A live reservation's provenance disappears even though counters survive.
      await client.unsafe(forward);
      await client`UPDATE transcription_jobs SET funding_source='operator',quota_state='reserved',lease_token=${randomUUID()}`;
      await client.unsafe(rollback);
      expect(await client`SELECT count FROM ai_usage`).toEqual([{ count: 7 }]);
      expect((await client`SELECT * FROM transcription_jobs`)[0]).not.toHaveProperty('quota_state');
      await expect(
        client.unsafe(forward.replace('COMMIT;', 'SELECT 1/0; COMMIT;')),
      ).rejects.toMatchObject({ code: '22012' });
      await client`ROLLBACK`;
      expect(
        await client`SELECT column_name FROM information_schema.columns WHERE table_name='transcription_jobs' AND column_name='lease_token'`,
      ).toEqual([]);
      // Exact forward lock timeout: hold the table from a distinct connection.
      let attempted!: Promise<unknown>;
      await locking.begin(async (tx) => {
        await tx`LOCK TABLE transcription_jobs IN ACCESS SHARE MODE`;
        attempted = client.unsafe(forward).then(
          () => {
            throw new Error('Expected lock timeout');
          },
          (error: unknown) => error,
        );
        expect(await attempted).toMatchObject({ code: '55P03' });
      });
      await client`ROLLBACK`;
      expect(
        await client`SELECT column_name FROM information_schema.columns WHERE table_name='transcription_jobs' AND column_name='lease_token'`,
      ).toEqual([]);
    } finally {
      await Promise.all([client.end({ timeout: 5 }), locking.end({ timeout: 5 })]);
    }
  });
});
