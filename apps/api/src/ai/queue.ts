/**
 * The transcription queue.
 *
 * Every piece of state a running job has lives in Postgres, which is the whole
 * point. The implementation this replaces kept the running set and the progress
 * in module-level `Map`s: correct while the process lived, and silently wrong
 * the moment it did not. A deploy, a crash, or a free-tier instance being reaped
 * mid-job left the transcript row saying `processing` with nothing working on
 * it, and the client polling forever a job that would never finish and never
 * fail. Nothing could tell that apart from slow progress, so nothing recovered.
 *
 * Claiming is a single statement rather than a read followed by a write. Two
 * workers polling the same table will select the same top row, and a
 * check-then-act between them hands the job to both — which on this workload
 * means paying a transcription provider twice for one episode.
 */

import { transcriptionJobs, type Database, type TranscriptionJobRow } from '@cue/db';
export type { TranscriptionJobRow };
import { and, eq, sql } from 'drizzle-orm';

/**
 * How long a claimed job may go quiet before another worker may take it.
 *
 * Comfortably longer than the gap between heartbeats, because the cost of
 * being wrong is asymmetric: reclaiming a job that was merely slow duplicates
 * an expensive upload, while waiting too long only delays a retry nobody is
 * watching by a minute.
 */
const STALE_AFTER_SEC = 180;

/**
 * How many times a job may be claimed before it is abandoned.
 *
 * Counted on claim rather than on failure, which is the distinction that
 * matters: a job that fails cleanly increments this on its way out, and so does
 * a job that takes the whole process down with it. Counting only clean failures
 * would retry a poison job forever, and every retry would take down whatever
 * else that worker was about to do.
 */
export const MAX_ATTEMPTS = 3;

export type JobProgress = {
  stage: 'fetching' | 'splitting' | 'transcribing' | 'waiting' | 'saving';
  done: number;
  total: number;
  /**
   * When a `waiting` job expects to resume, as an epoch millisecond count.
   *
   * Only ever set alongside `stage: 'waiting'`; every other stage leaves it
   * undefined, and `heartbeat` writes null for those so a deadline cannot
   * outlive the wait that produced it.
   */
  waitingUntilMs?: number;
};

/**
 * What a claim hands back.
 *
 * Deliberately not the whole row. The claim is raw SQL — Drizzle's query builder
 * has no `FOR UPDATE SKIP LOCKED` — and raw SQL comes back with the database's
 * own column names, so `RETURNING *` would yield `episode_id` while the row type
 * promises `episodeId`. Typing it as the full row was exactly that lie, and it
 * type-checked perfectly while every field read back `undefined`. Naming the
 * four columns the worker actually needs, aliased, keeps the type honest.
 */
export type ClaimedJob = {
  episodeId: string;
  userId: string | null;
  quotaDay: string | null;
  attempts: number;
};

/**
 * Put an episode in the queue, or leave the existing job alone.
 *
 * Idempotent by primary key: two people opening the same episode and both
 * pressing the button is ordinary, not a race to resolve. The second one joins
 * the first one's job rather than starting a second.
 *
 * A `failed` job is revived here — that is what makes the button work again
 * after something went wrong, without a separate retry path to keep correct.
 */
export async function enqueue(
  db: Database,
  input: { episodeId: string; userId: string; quotaDay: string | null },
): Promise<void> {
  await db
    .insert(transcriptionJobs)
    .values({
      episodeId: input.episodeId,
      userId: input.userId,
      quotaDay: input.quotaDay,
      status: 'queued',
    })
    .onConflictDoUpdate({
      target: transcriptionJobs.episodeId,
      set: {
        status: 'queued',
        attempts: 0,
        detail: null,
        stage: null,
        done: 0,
        total: 0,
        userId: input.userId,
        quotaDay: input.quotaDay,
      },
      // Only a job that has given up is restarted. Without this, pressing the
      // button while a job is genuinely running would reset its attempt count
      // and wipe the progress the user is currently watching.
      where: eq(transcriptionJobs.status, 'failed'),
    });
}

/**
 * Take the next job, atomically.
 *
 * `FOR UPDATE SKIP LOCKED` inside the subquery is what makes this safe to run
 * from more than one worker: each transaction locks a different row rather than
 * queueing behind the same one, so two workers get two jobs instead of one job
 * twice or one worker blocking on the other.
 *
 * Abandoned jobs are picked up by the same statement rather than by a separate
 * sweeper. A `running` row whose heartbeat has gone quiet is indistinguishable,
 * from the outside, from one that was never claimed — so treating them as the
 * same thing is both simpler and the behaviour we want.
 */
export async function claimNext(db: Database): Promise<ClaimedJob | null> {
  const rows = await db.execute(sql`
    UPDATE ${transcriptionJobs}
    SET status = 'running',
        heartbeat_at = now(),
        attempts = ${transcriptionJobs.attempts} + 1
    WHERE episode_id = (
      SELECT episode_id FROM ${transcriptionJobs}
      WHERE (
        status = 'queued'
        OR (status = 'running' AND heartbeat_at < now() - make_interval(secs => ${STALE_AFTER_SEC}))
      )
      AND attempts < ${MAX_ATTEMPTS}
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING episode_id AS "episodeId",
              user_id    AS "userId",
              quota_day  AS "quotaDay",
              attempts
  `);

  // `execute` returns the driver's own shape: an array under PGlite, an object
  // with `rows` under postgres-js. Both are in use here — PGlite in tests and
  // local development, postgres-js in production — so neither can be assumed.
  const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
  const row = list[0] as ClaimedJob | undefined;

  return row ?? null;
}

/**
 * Say the job is still alive, and how far along it is.
 *
 * The progress ride-along is deliberate: it is written on the same beat that
 * proves the worker is breathing, so a job cannot be reporting progress and
 * appear abandoned at the same time. It is also why progress can be read by a
 * different instance than the one doing the work, which the in-memory version
 * could not do — behind more than one server, the poll usually landed somewhere
 * else and saw nothing.
 */
export async function heartbeat(
  db: Database,
  episodeId: string,
  progress?: JobProgress,
): Promise<void> {
  await db
    .update(transcriptionJobs)
    .set({
      heartbeatAt: new Date(),
      ...(progress
        ? {
            stage: progress.stage,
            done: progress.done,
            total: progress.total,
            /*
              Written on every progress beat, not only on the waiting ones, so
              that leaving the waiting stage clears the deadline as a matter of
              course. Setting it only where it applies would leave the last
              wait's instant sitting on the row through the upload that
              followed, and the client would render a countdown to a moment in
              the past for the rest of the job.
            */
            waitingUntil: progress.waitingUntilMs ? new Date(progress.waitingUntilMs) : null,
          }
        : {}),
    })
    .where(eq(transcriptionJobs.episodeId, episodeId));
}

/** Done. The row is deleted — a finished job is not a record worth keeping. */
export async function complete(db: Database, episodeId: string): Promise<void> {
  await db.delete(transcriptionJobs).where(eq(transcriptionJobs.episodeId, episodeId));
}

/**
 * This attempt failed.
 *
 * Returns whether the job is finished with — out of attempts — so the caller can
 * decide whether the *transcript* should be marked failed too. A job that will
 * be retried must not leave a failure on the transcript, or the UI reports a
 * dead end while a retry is queued behind it.
 */
export async function fail(
  db: Database,
  episodeId: string,
  detail: string,
): Promise<{ exhausted: boolean }> {
  const [row] = await db
    .update(transcriptionJobs)
    .set({ status: 'failed', detail, stage: null })
    .where(eq(transcriptionJobs.episodeId, episodeId))
    .returning({ attempts: transcriptionJobs.attempts });

  return { exhausted: (row?.attempts ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS };
}

/** The job for an episode, or null. Drives the progress the client polls. */
export async function jobFor(
  db: Database,
  episodeId: string,
): Promise<TranscriptionJobRow | null> {
  const [row] = await db
    .select()
    .from(transcriptionJobs)
    .where(eq(transcriptionJobs.episodeId, episodeId))
    .limit(1);

  return row ?? null;
}

/**
 * Whether an episode is queued or being worked on *anywhere*.
 *
 * Deliberately a database question. The old `inFlight` set could only answer
 * for the process that happened to receive the request, so behind two instances
 * it reported "not running" for a job that plainly was, and a second one
 * started.
 */
export async function isActive(db: Database, episodeId: string): Promise<boolean> {
  const [row] = await db
    .select({ episodeId: transcriptionJobs.episodeId })
    .from(transcriptionJobs)
    .where(
      and(
        eq(transcriptionJobs.episodeId, episodeId),
        sql`${transcriptionJobs.status} IN ('queued', 'running')`,
      ),
    )
    .limit(1);

  return row !== undefined;
}
