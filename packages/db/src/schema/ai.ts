/**
 * AI: what was generated, who spent what, and whose key paid for it.
 *
 * The three tables answer three different questions and are deliberately not
 * merged. `episode_ai` is a **shared** cache — a summary of an episode is a
 * fact about the episode, not about the person who happened to ask first, so
 * one generation serves everyone and the second reader pays nothing. `ai_usage`
 * is strictly per-user and exists only to meter the operator's key.
 * `user_api_keys` holds the secret that lets someone opt out of that meter.
 */

import { date, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { episodes } from './catalog.ts';

/**
 * Generated artefacts, cached per episode.
 *
 * Keyed by language as well as kind, because the same episode summarised in
 * Hindi is a different artefact and not a translation of this row — asking the
 * model in the target language produces better prose than translating English
 * output, and Phase 11 will want both to coexist.
 *
 * `content` is JSONB rather than text because the shapes differ per kind: a
 * summary is prose, takeaways are a list, chapters are a list of objects with
 * timings. Storing three shapes in one column is what the discriminator is for.
 */
export const episodeAi = pgTable(
  'episode_ai',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),

    /** `summary` | `takeaways` | `chapters`. */
    kind: text('kind').notNull(),
    language: text('language').notNull().default('en'),

    content: jsonb('content').notNull(),

    /**
     * Which model produced it.
     *
     * Recorded so a bad generation can be traced to the model that made it, and
     * so a future model upgrade can invalidate only what the old one wrote
     * rather than dropping a cache that took real money to fill.
     */
    model: text('model').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One artefact per episode per kind per language; generation upserts onto this. */
    uniqueIndex('episode_ai_episode_kind_language_key').on(t.episodeId, t.kind, t.language),
  ],
).enableRLS();

/**
 * Daily spend against the **operator's** key.
 *
 * Counted in requests rather than tokens: the quota exists to stop one person
 * exhausting a shared free tier, and a request is the unit a user can actually
 * reason about. Tokens would be more accurate and completely opaque — "you have
 * 12 requests left today" is actionable in a way that a token budget is not.
 *
 * Rows are only written for operator-key calls. Someone using their own key is
 * spending their own money and is never metered, which is the entire point of
 * offering BYOK.
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * The UTC day. Not the user's local day: the alternative needs a stored
     * timezone per user and makes the quota reset at a different instant for
     * everyone, which turns "did my quota reset?" into a support question.
     */
    day: date('day', { mode: 'string' }).notNull(),

    count: integer('count').notNull().default(0),
  },
  (t) => [uniqueIndex('ai_usage_user_day_key').on(t.userId, t.day)],
).enableRLS();

/**
 * A user's own provider key, encrypted at rest.
 *
 * The ciphertext never leaves the server and is decrypted into memory for the
 * duration of a single call. There is deliberately **no endpoint that returns
 * it** — not masked, not partially. `hint` exists so the UI can say which key
 * is saved without the plaintext ever being readable again, by anyone,
 * including us.
 */
export const userApiKeys = pgTable(
  'user_api_keys',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Only `groq` today. A column rather than an assumption, so adding one is a row. */
    provider: text('provider').notNull().default('groq'),

    /**
     * AES-256-GCM, as `iv.tag.ciphertext` in base64url.
     *
     * One column rather than three: the parts are meaningless apart and always
     * read together, and a schema that lets an IV be updated without its
     * ciphertext invites exactly the bug that breaks decryption silently.
     */
    secret: text('secret').notNull(),

    /** Last four characters of the key, for the UI. Never enough to use. */
    hint: text('hint').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  // One index, not two: a unique index on `(user_id, provider)` already serves
  // lookups by `user_id` alone, since it leads with that column. A second index
  // on the prefix would be maintained on every write and never chosen.
  (t) => [uniqueIndex('user_api_keys_user_provider_key').on(t.userId, t.provider)],
).enableRLS();

export type EpisodeAiRow = typeof episodeAi.$inferSelect;
export type NewEpisodeAiRow = typeof episodeAi.$inferInsert;
export type AiUsageRow = typeof aiUsage.$inferSelect;
export type UserApiKeyRow = typeof userApiKeys.$inferSelect;
