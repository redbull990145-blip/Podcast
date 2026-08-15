/**
 * Playlists.
 *
 * A queue answers "what next"; a playlist answers "what for" — long drives, the
 * ones worth a second listen, the four episodes someone recommended. That is
 * the whole justification, and it is a private one: nothing here is shared,
 * published, or collaborative, and there is no `visibility` column waiting for
 * a feature nobody has asked for. Adding one later is one migration.
 *
 * The ordering is the same fractional-key scheme the queue uses, for the same
 * reason: moving an item writes one row rather than renumbering the list, and
 * two devices inserting into the same gap produce different keys instead of
 * fighting over an integer.
 */

import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { episodes } from './catalog.ts';

export const playlists = pgTable(
  'playlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    description: text('description'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Touched when the playlist's *contents* change, not only its title.
     *
     * This is what the list is sorted by, and "recently used" is what someone
     * means when they go looking for a playlist — which is usually the one they
     * just added an episode to, not the one they last renamed.
     */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * Shaped for the only read there is: this user's playlists, most recently
     * touched first. The `userId` prefix is what stops one user's rows being
     * scanned for another's.
     */
    index('playlists_user_idx').on(t.userId, t.updatedAt.desc()),
  ],
);

export const playlistItems = pgTable(
  'playlist_items',
  {
    playlistId: uuid('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),

    /** Fractional index, compared as a plain string. See `@cue/core`'s sort-key. */
    sortKey: text('sort_key').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * An episode appears in a given playlist at most once.
     *
     * A deliberate constraint rather than an oversight: a playlist with the
     * same episode twice is almost always a double tap, and the alternative —
     * allowing duplicates — means every remove has to disambiguate *which* copy.
     */
    uniqueIndex('playlist_items_playlist_episode_key').on(t.playlistId, t.episodeId),

    /** Reading a playlist in order is the only way it is ever read. */
    index('playlist_items_order_idx').on(t.playlistId, t.sortKey),

    /** The reverse direction: which playlists hold this episode. */
    index('playlist_items_episode_idx').on(t.episodeId),
  ],
);

export type PlaylistRow = typeof playlists.$inferSelect;
export type PlaylistItemRow = typeof playlistItems.$inferSelect;
