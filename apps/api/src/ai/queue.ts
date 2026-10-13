/** Durable admission, attempt ownership and settlement share one transaction model. */
import {
  aiUsage,
  episodes,
  transcriptionJobs,
  transcripts,
  type Database,
  type DatabaseTransaction,
  type StoredSegment,
  type TranscriptionJobRow,
} from '@cue/db';
import { and, eq, gt, ne, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.ts';
import { claimQuota } from './access.ts';
import { assertJobSchema } from './queue-schema.ts';

export type { TranscriptionJobRow };
export const STALE_AFTER_SEC = 180;
export const MAX_ATTEMPTS = 3;
export type JobProgress = {
  stage: 'fetching' | 'splitting' | 'transcribing' | 'waiting' | 'saving';
  done: number;
  total: number;
  waitingUntilMs?: number;
};
export type ClaimedJob = {
  episodeId: string;
  userId: string | null;
  quotaDay: string | null;
  attempts: number;
  leaseToken: string;
  fundingSource: 'byok' | 'operator';
};
type Transaction = DatabaseTransaction;
/** Server deadlines roll back the owned SQL transaction; no detached SQL races. */
async function jobTransaction<T>(db: Database, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw("SET LOCAL lock_timeout = '5s'"));
    await tx.execute(sql.raw("SET LOCAL statement_timeout = '30s'"));
    return work(tx);
  });
}
const usable = sql.raw(
  "funding_source IN ('byok', 'operator') AND quota_state IN ('unmetered', 'reserved')",
);
const stale = sql.raw(
  `(heartbeat_at IS NULL OR heartbeat_at < now() - interval '${STALE_AFTER_SEC} seconds')`,
);
const claimable = and(
  usable,
  or(eq(transcriptionJobs.status, 'queued'), and(eq(transcriptionJobs.status, 'running'), stale)),
);

/** All multi-row mutations use episode, job, then quota lock order. */
async function lockEpisode(
  tx: Transaction,
  episodeId: string,
  skipLocked = false,
): Promise<boolean> {
  return (
    (
      await tx
        .select({ id: episodes.id })
        .from(episodes)
        .where(eq(episodes.id, episodeId))
        .for('update', skipLocked ? { skipLocked: true } : {})
    ).length > 0
  );
}
async function owned(tx: Transaction, lease: ClaimedJob): Promise<TranscriptionJobRow | null> {
  if (!(await lockEpisode(tx, lease.episodeId))) return null;
  const [job] = await tx
    .select()
    .from(transcriptionJobs)
    .where(
      and(
        eq(transcriptionJobs.episodeId, lease.episodeId),
        eq(transcriptionJobs.leaseToken, lease.leaseToken),
        eq(transcriptionJobs.status, 'running'),
        usable,
      ),
    )
    .for('update');
  return job ?? null;
}
const processing = (episodeId: string) => ({
  episodeId,
  source: 'generated',
  status: 'processing',
  language: 'en',
  detail: null,
  segments: [] as StoredSegment[],
  alignment: null,
  audioDurationMs: null,
  audioBytes: null,
  fetchedAt: new Date(),
});

/** Duplicate/ready checks, quota reservation and visible job state commit together. */
export async function admit(
  app: FastifyInstance,
  episodeId: string,
  userId: string,
): Promise<{ started: boolean; detail: string | null }> {
  await assertJobSchema(app.db);
  let reservation: { fundingSource: string; quotaState: string } | undefined;
  const outcome = await jobTransaction(app.db, async (tx) => {
    if (!(await lockEpisode(tx, episodeId))) throw new AppError('not_found', 'Episode not found');
    const [job] = await tx
      .select()
      .from(transcriptionJobs)
      .where(eq(transcriptionJobs.episodeId, episodeId))
      .for('update');
    if (job?.fundingSource === 'legacy' || job?.quotaState === 'legacy')
      throw new AppError(
        'conflict',
        'This older job needs an approved recovery review before it can run again.',
      );
    const [transcript] = await tx
      .select()
      .from(transcripts)
      .where(eq(transcripts.episodeId, episodeId));
    if (transcript?.status === 'ready' && transcript.segments.length)
      return {
        started: false,
        detail: 'This episode already has a transcript',
      };
    if (job && ['queued', 'running'].includes(job.status))
      return { started: false, detail: 'Already being transcribed' };
    if (
      job &&
      (job.status !== 'failed' ||
        (job.fundingSource === 'operator' && job.quotaState !== 'refunded'))
    )
      throw new AppError('conflict', 'This job has an unsettled reservation.');
    const { metered, day } = await claimQuota(app, userId, tx);
    const values = {
      episodeId,
      userId,
      quotaDay: day,
      fundingSource: metered ? 'operator' : 'byok',
      quotaState: metered ? 'reserved' : 'unmetered',
      status: 'queued',
      attempts: 0,
      leaseToken: null,
      heartbeatAt: null,
      stage: null,
      done: 0,
      total: 0,
      waitingUntil: null,
      detail: null,
      createdAt: new Date(),
    };
    if (job)
      await tx
        .update(transcriptionJobs)
        .set(values)
        .where(eq(transcriptionJobs.episodeId, episodeId));
    else await tx.insert(transcriptionJobs).values(values);
    await tx
      .insert(transcripts)
      .values(processing(episodeId))
      .onConflictDoUpdate({
        target: transcripts.episodeId,
        set: processing(episodeId),
      });
    reservation = {
      fundingSource: values.fundingSource,
      quotaState: values.quotaState,
    };
    return { started: true, detail: null };
  });
  if (reservation)
    app.log?.info({ episodeId, attempts: 0, ...reservation }, 'transcription admission reserved');
  return outcome;
}

/** Candidate reads never establish ownership; recheck after taking the row locks. */
export async function claimNext(db: Database): Promise<ClaimedJob | null> {
  await assertJobSchema(db);
  // Keep the server's full timestamp precision: a JS Date loses microseconds
  // and can otherwise repeat a locked page forever on native PostgreSQL.
  let cursor: { createdAt: string; episodeId: string } | undefined;
  for (;;) {
    const after = cursor
      ? or(
          gt(transcriptionJobs.createdAt, sql`${cursor.createdAt}::timestamptz`),
          and(
            eq(transcriptionJobs.createdAt, sql`${cursor.createdAt}::timestamptz`),
            gt(transcriptionJobs.episodeId, cursor.episodeId),
          ),
        )
      : undefined;
    const candidates = await db
      .select({
        episodeId: transcriptionJobs.episodeId,
        createdAt: sql<string>`${transcriptionJobs.createdAt}::text`,
      })
      .from(transcriptionJobs)
      .where(and(claimable, after))
      .orderBy(transcriptionJobs.createdAt, transcriptionJobs.episodeId)
      .limit(32);
    if (!candidates.length) return null;
    for (const candidate of candidates) {
      const claimed = await jobTransaction(db, async (tx) => {
        if (!(await lockEpisode(tx, candidate.episodeId, true))) return null;
        const [job] = await tx
          .select()
          .from(transcriptionJobs)
          .where(and(eq(transcriptionJobs.episodeId, candidate.episodeId), claimable))
          .for('update', { skipLocked: true });
        if (!job) return null;
        if (job.attempts >= MAX_ATTEMPTS) {
          const recoveryToken = randomUUID();
          await tx
            .update(transcriptionJobs)
            .set({ leaseToken: recoveryToken, status: 'running' })
            .where(eq(transcriptionJobs.episodeId, job.episodeId));
          await settleFailure(
            tx,
            { ...job, leaseToken: recoveryToken },
            'The worker stopped before this attempt finished.',
            true,
          );
          return null;
        }
        const leaseToken = randomUUID();
        await tx
          .update(transcriptionJobs)
          .set({
            status: 'running',
            leaseToken,
            heartbeatAt: sql.raw('now()'),
            attempts: job.attempts + 1,
            waitingUntil: null,
          })
          .where(eq(transcriptionJobs.episodeId, job.episodeId));
        return {
          episodeId: job.episodeId,
          userId: job.userId,
          quotaDay: job.quotaDay,
          fundingSource: job.fundingSource as 'byok' | 'operator',
          attempts: job.attempts + 1,
          leaseToken,
        };
      });
      if (claimed) return claimed;
    }
    const last = candidates.at(-1)!;
    cursor = { createdAt: last.createdAt, episodeId: last.episodeId };
  }
}

/** A stale beat updates neither progress nor liveness. */
export async function heartbeat(
  db: Database,
  lease: ClaimedJob,
  progress?: JobProgress,
): Promise<boolean> {
  await assertJobSchema(db);
  const rows = await jobTransaction(db, (tx) =>
    tx
      .update(transcriptionJobs)
      .set({
        heartbeatAt: sql.raw('now()'),
        ...(progress
          ? {
              stage: progress.stage,
              done: progress.done,
              total: progress.total,
              waitingUntil: progress.waitingUntilMs ? new Date(progress.waitingUntilMs) : null,
            }
          : {}),
      })
      .where(
        and(
          eq(transcriptionJobs.episodeId, lease.episodeId),
          eq(transcriptionJobs.leaseToken, lease.leaseToken),
          eq(transcriptionJobs.status, 'running'),
          usable,
        ),
      )
      .returning({ id: transcriptionJobs.episodeId }),
  );
  return rows.length === 1;
}

/** Transcript save and successful completion are one fenced commit. */
export async function complete(
  db: Database,
  lease: ClaimedJob,
  result: {
    segments: StoredSegment[];
    audioDurationMs: number;
    audioBytes: number;
  },
): Promise<boolean> {
  await assertJobSchema(db);
  return jobTransaction(db, async (tx) => {
    const job = await owned(tx, lease);
    if (!job) return false;
    if (!result.segments.length) throw new Error('Cannot complete an empty transcript');
    await tx
      .insert(transcripts)
      .values({ ...processing(job.episodeId), ...result, status: 'ready' })
      .onConflictDoUpdate({
        target: transcripts.episodeId,
        set: {
          ...result,
          status: 'ready',
          source: 'generated',
          detail: null,
          alignment: null,
          fetchedAt: new Date(),
        },
      });
    await tx
      .delete(transcriptionJobs)
      .where(
        and(
          eq(transcriptionJobs.episodeId, job.episodeId),
          eq(transcriptionJobs.leaseToken, lease.leaseToken),
        ),
      );
    return true;
  });
}

async function settleFailure(
  tx: Transaction,
  job: TranscriptionJobRow,
  detail: string,
  terminal: boolean,
): Promise<void> {
  // Account/day come from the locked row, never from caller-supplied metadata.
  if (
    terminal &&
    job.fundingSource === 'operator' &&
    job.quotaState === 'reserved' &&
    job.userId &&
    job.quotaDay
  ) {
    const refunded = await tx
      .update(aiUsage)
      .set({ count: sql.raw('count - 1') })
      .where(
        and(eq(aiUsage.userId, job.userId), eq(aiUsage.day, job.quotaDay), gt(aiUsage.count, 0)),
      )
      .returning({ count: aiUsage.count });
    if (!refunded.length)
      throw new Error('The transcription reservation has no matching quota counter');
  }
  const quotaState = terminal && job.fundingSource === 'operator' ? 'refunded' : job.quotaState;
  await tx
    .update(transcriptionJobs)
    .set({
      status: terminal ? 'failed' : 'queued',
      quotaState,
      detail,
      stage: null,
      waitingUntil: null,
      heartbeatAt: null,
    })
    .where(
      and(
        eq(transcriptionJobs.episodeId, job.episodeId),
        eq(transcriptionJobs.leaseToken, job.leaseToken!),
      ),
    );
  await tx
    .update(transcripts)
    .set({
      status: terminal ? 'failed' : 'processing',
      detail: terminal ? detail : null,
    })
    .where(and(eq(transcripts.episodeId, job.episodeId), ne(transcripts.status, 'ready')));
}

export async function fail(
  db: Database,
  lease: ClaimedJob,
  detail: string,
  terminal = false,
): Promise<{ owned: boolean; exhausted: boolean }> {
  await assertJobSchema(db);
  return jobTransaction(db, async (tx) => {
    const job = await owned(tx, lease);
    if (!job) return { owned: false, exhausted: false };
    const exhausted = terminal || job.attempts >= MAX_ATTEMPTS;
    await settleFailure(tx, job, detail, exhausted);
    return { owned: true, exhausted };
  });
}

/** Reads preserve legacy state; mutation/claim paths quarantine it. */
export async function jobFor(db: Database, episodeId: string): Promise<TranscriptionJobRow | null> {
  await assertJobSchema(db);
  return (
    (
      await db
        .select()
        .from(transcriptionJobs)
        .where(eq(transcriptionJobs.episodeId, episodeId))
        .limit(1)
    )[0] ?? null
  );
}
export async function isActive(db: Database, episodeId: string): Promise<boolean> {
  const job = await jobFor(db, episodeId);
  return Boolean(
    job && job.fundingSource !== 'legacy' && ['queued', 'running'].includes(job.status),
  );
}
