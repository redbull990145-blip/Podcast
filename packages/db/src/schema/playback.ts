/**
 * Playback state: where you are in each episode, and what is queued next.
 *
 * The tables the audio engine writes to. Both are user-scoped and both are
 * written far more often than they are read, which shapes the indexes below.
 */

import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { episodes } from './catalog.ts';

export const playbackProgress = pgTable(
  'playback_progress',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),

    positionSec: integer('position_sec').notNull().default(0),
    /** As observed by the client that wrote this; feeds are unreliable. */
    durationSec: integer('duration_sec'),
    completed: boolean('completed').notNull().default(false),

    /**
     * Which device wrote this, and when.
     *
     * Both are load-bearing rather than diagnostic: reconciliation compares
     * timestamps to decide whether two records are concurrent playback (where
     * the further position wins) or a genuinely later session (where the newer
     * one does). Without the device id we could not tell a peer's write from
     * our own echo.
     */
    deviceId: text('device_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One row per user per episode; every write is an upsert onto this. */
    uniqueIndex('playback_progress_user_episode_key').on(t.userId, t.episodeId),

    /**
     * Drives "Continue listening": a user's most recently touched episodes,
     * unfinished ones first. The `userId` prefix keeps one user's rows from
     * being scanned for another's.
     */
    index('playback_progress_continue_idx').on(t.userId, t.updatedAt.desc()),
  ],
);

export const queueItems = pgTable(
  'queue_items',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),

    /**
     * Fractional index, compared as a plain string.
     *
     * Reordering writes one row instead of renumbering the whole queue, which
     * is what keeps drag-to-reorder instant on a long queue — and lets two
     * devices insert into the same gap without colliding on an integer.
     */
    sortKey: text('sort_key').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** An episode appears in a queue at most once. */
    uniqueIndex('queue_items_user_episode_key').on(t.userId, t.episodeId),
    /** Reading the queue in order is the only way it is ever read. */
    index('queue_items_order_idx').on(t.userId, t.sortKey),
  ],
);

export type PlaybackProgressRow = typeof playbackProgress.$inferSelect;
export type QueueItemRow = typeof queueItems.$inferSelect;
