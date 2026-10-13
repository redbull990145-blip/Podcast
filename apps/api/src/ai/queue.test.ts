/**
 * The queue, against isolated PGlite (not multi-connection PostgreSQL).
 *
 * These run on PGlite rather than a mock because the whole design rests on
 * database semantics — `FOR UPDATE SKIP LOCKED`, an upsert with a `WHERE` on the
 * conflict, `now()` arithmetic. A fake would prove the code calls Drizzle, which
 * is not the part that can be wrong.
 */

import {
  episodes,
  podcasts,
  transcriptionJobs,
  transcripts,
  aiUsage,
  userApiKeys,
  users,
  type Database,
} from '@cue/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../test/database.ts';
import {
  admit,
  claimNext as claim,
  complete as finish,
  fail as failAttempt,
  heartbeat as beat,
  isActive,
  jobFor,
  MAX_ATTEMPTS,
  type ClaimedJob,
  type JobProgress,
} from './queue.ts';
import { loadConfig } from '../config.ts';
import { encryptSecret } from './crypto.ts';
import { utcDay } from './access.ts';
import type { FastifyInstance } from 'fastify';

const encryption = 'isolated-queue-encryption-test-secret';
let latestLease: ClaimedJob;
async function enqueue(
  db: Database,
  input: { episodeId: string; userId: string; quotaDay: string | null },
) {
  await db.delete(userApiKeys);
  if (input.quotaDay === null)
    await db.insert(userApiKeys).values({
      userId: input.userId,
      provider: 'groq',
      secret: encryptSecret('own-test-key', encryption),
      hint: 'test',
    });
  return admit(
    {
      db,
      config: loadConfig({
        DATABASE_URL: 'pglite://memory',
        GROQ_API_KEY: 'operator-test-key',
        API_KEY_ENCRYPTION_SECRET: encryption,
      }),
    } as FastifyInstance,
    input.episodeId,
    input.userId,
  );
}
async function claimNext(db: Database) {
  const lease = await claim(db);
  if (lease) latestLease = lease;
  return lease;
}
const heartbeat = (db: Database, _episodeId: string, progress: JobProgress) =>
  beat(db, latestLease, progress);
const fail = (db: Database, _episodeId: string, detail: string, terminal = false) =>
  failAttempt(db, latestLease, detail, terminal);
const complete = (db: Database, _episodeId: string) =>
  finish(db, latestLease, {
    segments: [{ index: 0, startMs: 0, endMs: 1000, text: 'test', speaker: null }],
    audioDurationMs: 1000,
    audioBytes: 100,
  });

/**
 * The harness owns the lifecycle; `db` is the same object typed as the
 * application sees it.
 *
 * `Database` is the postgres-js flavour and this is the PGlite one, which differ
 * only in the driver hanging off `$client` — the same cast `createDatabase`
 * makes internally on its own `pglite:` path, and the one every other suite here
 * makes per call site. Done once, at the boundary, rather than at each of the
 * thirty calls below.
 */
let harness: TestDatabase;
let db: Database;
let episodeId: string;

const USER = 'user-queue-test';

beforeAll(async () => {
  harness = await createTestDatabase();
  db = harness as unknown as Database;

  await db.insert(users).values({
    id: USER,
    name: 'Test Listener',
    email: 'queue@example.com',
  });

  const [podcast] = await db
    .insert(podcasts)
    .values({ feedUrl: 'https://example.com/feed.xml', title: 'Test Show' })
    .returning({ id: podcasts.id });

  const [episode] = await db
    .insert(episodes)
    .values({
      podcastId: podcast!.id,
      guid: 'episode-1',
      title: 'Episode 1',
      audioUrl: 'https://example.com/1.mp3',
      publishedAt: new Date('2024-01-01'),
    })
    .returning({ id: episodes.id });

  episodeId = episode!.id;
});

afterAll(async () => {
  await harness.$close();
});

beforeEach(async () => {
  await db.delete(transcriptionJobs);
  await db.delete(transcripts);
  await db.delete(aiUsage);
  await db.delete(userApiKeys);
});

/** Push the heartbeat into the past, standing in for a worker that died. */
async function silenceFor(seconds: number) {
  await db
    .update(transcriptionJobs)
    .set({ heartbeatAt: sql`now() - make_interval(secs => ${seconds})` })
    .where(eq(transcriptionJobs.episodeId, episodeId));
}

describe('enqueue', () => {
  it('records the job as queued', async () => {
    await enqueue(db, { episodeId, userId: USER, quotaDay: '2026-08-16' });

    const job = await jobFor(db, episodeId);
    expect(job?.status).toBe('queued');
    expect(job?.quotaDay).toBe(utcDay());
    expect(job?.attempts).toBe(0);
  });

  it('does not restart a job that is already running', async () => {
    await enqueue(db, { episodeId, userId: USER, quotaDay: null });
    await claimNext(db);
    await heartbeat(db, episodeId, {
      stage: 'transcribing',
      done: 2,
      total: 5,
    });

    // Someone presses the button again while it is working.
    await enqueue(db, { episodeId, userId: USER, quotaDay: null });

    const job = await jobFor(db, episodeId);
    // Resetting here would wipe the progress being watched and hand the job a
    // fresh set of attempts.
    expect(job?.status).toBe('running');
    expect(job?.done).toBe(2);
  });

  it('revives a job that gave up, so the button works again', async () => {
    await enqueue(db, { episodeId, userId: USER, quotaDay: null });
    await claimNext(db);
    await fail(db, episodeId, 'the audio was unreachable', true);

    await enqueue(db, { episodeId, userId: USER, quotaDay: null });

    const job = await jobFor(db, episodeId);
    expect(job?.status).toBe('queued');
    expect(job?.attempts).toBe(0);
    expect(job?.detail).toBeNull();
  });
});

describe('claimNext', () => {
  it('returns nothing when the queue is empty', async () => {
    expect(await claimNext(db)).toBeNull();
  });

  it('claims a queued job and counts the attempt', async () => {
    await enqueue(db, { episodeId, userId: USER, quotaDay: null });

    const claimed = await claimNext(db);

    expect(claimed?.episodeId).toBe(episodeId);
    // Counted on claim, not on failure: a job that kills the process still has
    // to count as tried, or it is retried forever.
    expect(claimed?.attempts).toBe(1);
    // The claim is raw SQL, so the write is worth confirming through the query
    // builder rather than trusting the statement that made it.
    expect((await jobFor(db, episodeId))?.status).toBe('running');
  });

  it('does not hand the same running job to a second worker', async () => {
    await enqueue(db, { episodeId, userId: USER, quotaDay: null });

    expect(await claimNext(db)).not.toBeNull();
    // The expensive mistake: two workers transcribing one episode, billed twice.
    expect(await claimNext(db)).toBeNull();
  });

  it('reclaims a job whose worker went quiet', async () => {
    await enqueue(db, { episodeId, userId: USER, quotaDay: null });
    await claimNext(db);

    // Still 'running', but nothing has reported in for four minutes — the state
    // a crash or a killed container leaves behind, and the one the old
    // in-memory version could never detect.
    await silenceFor(240);

    const reclaimed = await claimNext(db);
    expect(reclaimed?.episodeId).toBe(episodeId);
    expect(reclaimed?.attempts).toBe(2);
  });

  it('leaves a job alone while it is still reporting', async () => {
    await enqueue(db, { episodeId, userId: USER, quotaDay: null });
    await claimNext(db);
    await silenceFor(240);
    await heartbeat(db, episodeId, {
      stage: 'transcribing',
      done: 1,
      total: 3,
    });

    // Slow is not the same as dead. Taking it here would duplicate an upload
    // that is actively in progress.
    expect(await claimNext(db)).toBeNull();
  });

  it('gives up on a job that has used its attempts', async () => {
    await enqueue(db, { episodeId, userId: USER, quotaDay: null });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(await claimNext(db)).not.toBeNull();
      await silenceFor(240);
    }

    // A job that reliably kills its worker must stop being retried, or it takes
    // down every job queued behind it too.
    expect(await claimNext(db)).toBeNull();
    expect((await jobFor(db, episodeId))?.status).toBe('failed');
  });
});

describe('settling', () => {
  it('deletes the row when the work is done', async () => {
    await enqueue(db, { episodeId, userId: USER, quotaDay: null });
    await claimNext(db);
    await complete(db, episodeId);

    expect(await jobFor(db, episodeId)).toBeNull();
    expect(await isActive(db, episodeId)).toBe(false);
  });

  it('reports whether the attempts are spent', async () => {
    await enqueue(db, { episodeId, userId: USER, quotaDay: null });

    await claimNext(db);
    // A retry is still coming, so the transcript must not be marked failed yet.
    expect((await fail(db, episodeId, 'first')).exhausted).toBe(false);

    // A transient retry retains its attempt count and admitted reservation.
    await enqueue(db, { episodeId, userId: USER, quotaDay: null });
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      await claimNext(db);
      await silenceFor(240);
    }

    expect((await fail(db, episodeId, 'last')).exhausted).toBe(true);
  });
});

describe('isActive', () => {
  it('is true while queued and while running, false once finished', async () => {
    expect(await isActive(db, episodeId)).toBe(false);

    await enqueue(db, { episodeId, userId: USER, quotaDay: null });
    expect(await isActive(db, episodeId)).toBe(true);

    await claimNext(db);
    expect(await isActive(db, episodeId)).toBe(true);

    await complete(db, episodeId);
    expect(await isActive(db, episodeId)).toBe(false);
  });
});
