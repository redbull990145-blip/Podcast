/**
 * Transcripts, cached per episode.
 *
 * Fetched lazily rather than at ingest. A single seed run already produces
 * 5,000+ episodes; fetching a caption file for every one of them would be
 * thousands of requests to publishers' CDNs for transcripts nobody has asked
 * to read. So the first person to open an episode pays for it once, and
 * everyone after that reads this row.
 *
 * **Segments live in one JSONB column rather than a `transcript_segments`
 * table.** The plan called for the second table with an index on
 * `(transcript_id, start_ms)`, which is the right shape for searching *across*
 * every transcript we hold. Nothing does that yet, and nothing in this phase
 * will: highlighting and search both operate on one episode's segments, which
 * are always loaded whole. Row-per-segment would mean ~2,000 rows per episode
 * and a join, to serve a query that is always "give me all of them, in order".
 * When cross-episode search arrives it needs a real full-text index anyway,
 * which is a different migration than the one avoided here.
 */

import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { episodes } from './catalog.ts';
import { users } from './auth.ts';

/** Mirrors `TranscriptSegment` in `@cue/types`. */
export type StoredSegment = {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker: string | null;
};

export const transcripts = pgTable(
  'transcripts',
  {
    episodeId: uuid('episode_id')
      .primaryKey()
      .references(() => episodes.id, { onDelete: 'cascade' }),

    /** `feed` for a publisher's own file; `generated` once we transcribe. */
    source: text('source').notNull().default('feed'),
    /**
     * `ready` or `failed`. A failure is recorded rather than left absent so a
     * publisher's dead transcript URL is not re-fetched on every page view —
     * the empty state is the answer, and it should be cheap.
     */
    status: text('status').notNull().default('ready'),
    language: text('language').notNull().default('en'),

    /** Why it failed, for the empty state to be specific rather than vague. */
    detail: text('detail'),

    segments: jsonb('segments').$type<StoredSegment[]>().notNull().default(sql`'[]'::jsonb`),

    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Retrying failures: "everything that failed, oldest first" is the only
    // query that does not go through the primary key.
    index('transcripts_status_idx').on(table.status, table.fetchedAt),
  ],
);

export type TranscriptRow = typeof transcripts.$inferSelect;
export type NewTranscriptRow = typeof transcripts.$inferInsert;

/**
 * Work waiting to be done, kept apart from the transcript it will produce.
 *
 * A separate table rather than more columns on `transcripts`, which is the
 * opposite of the call made above for segments — and for the opposite reason.
 * Segments are *part of* a transcript. A job is not: it has its own lifecycle
 * (claimed, retried, abandoned), its own access pattern (one queue-wide "what
 * is next", never by episode), and it stops existing when the transcript
 * starts. Putting the two in one row would mean a table where half the columns
 * are meaningless whenever the other half are set.
 *
 * The point of persisting this at all is that the previous implementation did
 * not. It held the running set and the progress in module-level `Map`s, so a
 * restart — a deploy, a crash, an idle instance being reaped — left the
 * transcript row saying `processing` with nothing in the world working on it,
 * and the client polling a job that would never finish or fail. State a
 * *process* holds cannot outlive that process; state a row holds can.
 */
export const transcriptionJobs = pgTable(
  'transcription_jobs',
  {
    /**
     * One job per episode, enforced by the primary key rather than by checking
     * first — two people opening the same episode and both pressing the button
     * is the normal case, not a race worth losing.
     */
    episodeId: uuid('episode_id')
      .primaryKey()
      .references(() => episodes.id, { onDelete: 'cascade' }),

    /**
     * Who asked. Kept so a failure can refund the right person's daily quota
     * from a different process than the one that spent it — the previous code
     * held that as a closure, which is precisely the kind of state a restart
     * destroys.
     *
     * `set null` rather than cascade: a deleted account is not a reason to
     * abandon a transcription other listeners are waiting on.
     */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),

    /**
     * The UTC day the quota was charged against, or null when it was not
     * metered — a user on their own key pays their own bill and has nothing to
     * refund. Storing the day rather than recomputing it matters for a job that
     * is claimed either side of midnight.
     */
    quotaDay: text('quota_day'),

    /** `queued` or `running`. A finished job is deleted; a dead one is `failed`. */
    status: text('status').notNull().default('queued'),

    /**
     * Incremented on claim, not on failure, so a job that kills the process
     * still counts as having been tried. Otherwise a job that reliably crashes
     * the worker is retried forever and takes every later job down with it.
     */
    attempts: integer('attempts').notNull().default(0),

    /**
     * Refreshed while work is happening. A `running` row whose heartbeat has
     * gone quiet is how another worker — or this one after a restart — can tell
     * an abandoned job from one that is merely slow, without a lock that has to
     * be released to be correct.
     */
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),

    /** `fetching`, `splitting`, `transcribing` or `saving`, for the progress ring. */
    stage: text('stage'),
    /** Chunks finished and chunks total; both 0 until the audio has been split. */
    done: integer('done').notNull().default(0),
    total: integer('total').notNull().default(0),

    /** Why the last attempt failed, so a retry can say something specific. */
    detail: text('detail'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The only query that is not by primary key: "what should I work on next",
    // oldest first. Also serves the sweep for abandoned jobs, which reads the
    // same two columns.
    index('transcription_jobs_queue_idx').on(table.status, table.createdAt),
  ],
);

export type TranscriptionJobRow = typeof transcriptionJobs.$inferSelect;
export type NewTranscriptionJobRow = typeof transcriptionJobs.$inferInsert;
