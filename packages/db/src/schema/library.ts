/**
 * A user's own data.
 *
 * Every table here is scoped by `user_id`, and every query that touches one
 * must filter on the session's user. That constraint is enforced in the API
 * layer rather than by row-level security, because the API connects with a
 * privileged role and RLS would never be evaluated — a deliberate choice,
 * documented so nobody mistakes it for an oversight.
 */

import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { podcasts } from './catalog.ts';

/**
 * App-specific user settings, kept separate from the Better Auth `users`
 * table so a library upgrade can never collide with our own columns.
 */
export const profiles = pgTable('profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Drives UI language, language-aware discovery, and date formatting. */
  locale: text('locale').notNull().default('en'),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // uuid, matching `podcasts.id` — a `text` column here would still create
    // the foreign key but force a cast on every join.
    podcastId: uuid('podcast_id')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    /** Per-show override of the global new-episode notification setting. */
    notifyOnNew: boolean('notify_on_new').notNull().default(true),
    subscribedAt: timestamp('subscribed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * Subscribing twice is a no-op, not an error — the button is optimistic,
     * so a double tap or a retried request must not create a second row.
     */
    uniqueIndex('subscriptions_user_podcast_key').on(t.userId, t.podcastId),

    /**
     * Shaped for the query that renders the library: a user's shows, newest
     * subscription first. The `userId` prefix is what keeps one user's rows
     * from being scanned for another's.
     */
    index('subscriptions_user_idx').on(t.userId, t.subscribedAt.desc()),

    /** The reverse direction, for "how many people follow this show". */
    index('subscriptions_podcast_idx').on(t.podcastId),
  ],
);

export type ProfileRow = typeof profiles.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
