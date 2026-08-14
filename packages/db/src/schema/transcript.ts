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
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { episodes } from './catalog.ts';

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
