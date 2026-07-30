import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/**
 * Data model for the podcast aggregator.
 *
 * Guiding rule: cache what is expensive or slow to refetch (show metadata,
 * episode lists, chapters, transcripts) and always re-derive what is cheap and
 * freshness-sensitive (new-episode checks) from live RSS via conditional GET.
 *
 * We never store audio. `episodes.enclosureUrl` is played directly from the
 * publisher's host, which is what keeps hosting cost at zero.
 *
 * `users.id` mirrors Supabase `auth.users.id`. The foreign key, the signup
 * trigger that populates this table, and all RLS policies live in
 * supabase/migrations/0001_auth_and_rls.sql — Drizzle does not manage the
 * `auth` schema.
 */

// ---------------------------------------------------------------------------
// Identity & settings
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name"),
  /** 'light' | 'dark' | 'system' */
  theme: text("theme").notNull().default("system"),
  /** Progressive disclosure toggle. Never gates paid features — only declutters. */
  powerUserMode: boolean("power_user_mode").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Optional BYOK override. Absence of a row simply means the user rides the
 * operator-funded default AI tier and its daily quota.
 *
 * `encryptedKey` is AES-256-GCM ciphertext produced by lib/crypto/apiKeys.ts.
 * It is decrypted in memory for the duration of a single call and is never
 * logged or returned to the client.
 */
export const userApiKeys = pgTable(
  "user_api_keys",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 'openai' | 'anthropic' | 'openrouter' | 'groq' */
    provider: text("provider").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    /** Last 4 chars, shown in Settings so users can identify the key. */
    keyHint: text("key_hint"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider] })],
);

/**
 * Daily quota counters for the operator-funded AI tier. Checked before a job is
 * enqueued and incremented on success. BYOK users skip this table entirely.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** UTC day the counters apply to. */
    day: date("day").notNull(),
    /** Expensive generation work: transcription, summaries, chapters. */
    jobsUsed: integer("jobs_used").notNull().default(0),
    /** Cheap Q&A turns against an already-cached transcript. */
    qaUsed: integer("qa_used").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

// ---------------------------------------------------------------------------
// Catalog cache
// ---------------------------------------------------------------------------

export const podcasts = pgTable(
  "podcasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feedUrl: text("feed_url").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    description: text("description"),
    artworkUrl: text("artwork_url"),
    /** Normalized tags. Primary input to the recommendation scorer. */
    categories: text("categories").array().notNull().default(sql`'{}'::text[]`),
    language: text("language"),
    link: text("link"),
    itunesId: bigint("itunes_id", { mode: "number" }),
    podcastindexId: bigint("podcastindex_id", { mode: "number" }),
    /** Drives refresh cadence. */
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    /** From RSS <lastBuildDate> — a cheap staleness check before a full parse. */
    lastBuildDate: timestamp("last_build_date", { withTimezone: true }),
    /** HTTP ETag / Last-Modified for conditional GET on refresh. */
    etag: text("etag"),
    lastModified: text("last_modified"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("podcasts_feed_url_idx").on(t.feedUrl),
    index("podcasts_itunes_id_idx").on(t.itunesId),
    index("podcasts_last_fetched_idx").on(t.lastFetchedAt),
  ],
);

export const episodes = pgTable(
  "episodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    podcastId: uuid("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    /** RSS <guid>, unique within a feed. */
    guid: text("guid").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** Played directly from the publisher's host. Never proxied or stored. */
    enclosureUrl: text("enclosure_url").notNull(),
    enclosureType: text("enclosure_type"),
    enclosureLength: bigint("enclosure_length", { mode: "number" }),
    durationSeconds: integer("duration_seconds"),
    episodeNumber: integer("episode_number"),
    seasonNumber: integer("season_number"),
    imageUrl: text("image_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** [{ startTime, title, url?, img? }] — resolved lazily, then cached here. */
    chapters: jsonb("chapters"),
    /** 'feed' | 'ai_generated' — drives the honest "AI-generated" badge. */
    chaptersSource: text("chapters_source"),
    /**
     * <podcast:chapters> URL. Persisted at ingest so resolving chapters for one
     * episode is a single small fetch rather than a re-parse of the whole feed.
     */
    chaptersUrl: text("chapters_url"),
    /** <podcast:transcript> URL when the publisher provides one. */
    transcriptUrl: text("transcript_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("episodes_podcast_guid_idx").on(t.podcastId, t.guid),
    index("episodes_podcast_published_idx").on(t.podcastId, t.publishedAt),
  ],
);

// ---------------------------------------------------------------------------
// Per-user library
// ---------------------------------------------------------------------------

export const subscriptions = pgTable(
  "subscriptions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    podcastId: uuid("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    /** Power-user overrides: { speed, skipSilence, volumeBoostDb, autoQueue }. */
    perShowSettings: jsonb("per_show_settings"),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.podcastId] }),
    index("subscriptions_user_idx").on(t.userId),
  ],
);

/**
 * One row per user+episode. Synced across devices via Supabase Realtime;
 * `updatedAt` is the last-write-wins conflict key.
 */
export const playbackState = pgTable(
  "playback_state",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    positionSeconds: numeric("position_seconds", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    played: boolean("played").notNull().default(false),
    lastPlayedAt: timestamp("last_played_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.episodeId] }),
    index("playback_state_user_recent_idx").on(t.userId, t.lastPlayedAt),
  ],
);

/**
 * "Up Next". `position` is a fractional index so a drag-reorder rewrites one
 * row instead of renumbering the whole list.
 */
export const queueItems = pgTable(
  "queue_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    position: doublePrecision("position").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("queue_items_user_episode_idx").on(t.userId, t.episodeId),
    index("queue_items_user_position_idx").on(t.userId, t.position),
  ],
);

/**
 * Download bookkeeping only. The audio bytes live in the browser's Cache
 * Storage, never on our server — downloads are per-device by design.
 */
export const downloads = pgTable(
  "downloads",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    /** 'queued' | 'downloading' | 'complete' | 'failed' */
    status: text("status").notNull().default("queued"),
    bytesDownloaded: bigint("bytes_downloaded", { mode: "number" }),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.episodeId, t.deviceId] }),
    index("downloads_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    /** 'transcribe' | 'summarize' | 'qa' | 'generate_chapters' */
    kind: text("kind").notNull(),
    /** 'queued' | 'downloading' | 'transcribing' | 'summarizing' | 'done' | 'error' */
    status: text("status").notNull().default("queued"),
    /** 'default' (operator-funded, quota'd) | 'byok' (user-funded, unlimited) */
    tier: text("tier").notNull().default("default"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_jobs_user_idx").on(t.userId, t.createdAt),
    index("ai_jobs_episode_kind_idx").on(t.episodeId, t.kind),
  ],
);

/**
 * Cached per episode, not per user. If one user's job produces a transcript,
 * every other user gets it for free and it does not touch their quota.
 */
export const transcripts = pgTable("transcripts", {
  episodeId: uuid("episode_id")
    .primaryKey()
    .references(() => episodes.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  /** [{ start, end, text }] — powers clickable timestamp citations. */
  segments: jsonb("segments"),
  /** e.g. 'groq/whisper-large-v3' | 'openai/whisper-1' */
  source: text("source").notNull(),
  /** Attribution and abuse-limiting only. */
  generatedByUserId: uuid("generated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const summaries = pgTable(
  "summaries",
  {
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    /** 'show_notes' | 'tldr' | 'key_takeaways' */
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.episodeId, t.kind] })],
);

// ---------------------------------------------------------------------------
// Recommendation signals
// ---------------------------------------------------------------------------

/**
 * Append-only signal log. `categorySnapshot` is denormalized so the scorer can
 * build a user's affinity vector without joining back to podcasts.
 */
export const listeningHistory = pgTable(
  "listening_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "set null" }),
    podcastId: uuid("podcast_id").references(() => podcasts.id, { onDelete: "set null" }),
    /** 'play_start' | 'complete' | 'skip' | 'not_interested' */
    event: text("event").notNull(),
    categorySnapshot: text("category_snapshot")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("listening_history_user_time_idx").on(t.userId, t.occurredAt)],
);

export const recommendationFeedback = pgTable(
  "recommendation_feedback",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    podcastId: uuid("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    /** 'thumbs_up' | 'thumbs_down' | 'not_interested' */
    signal: text("signal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.podcastId] })],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  subscriptions: many(subscriptions),
  queueItems: many(queueItems),
  apiKeys: many(userApiKeys),
}));

export const podcastsRelations = relations(podcasts, ({ many }) => ({
  episodes: many(episodes),
  subscriptions: many(subscriptions),
}));

export const episodesRelations = relations(episodes, ({ one, many }) => ({
  podcast: one(podcasts, {
    fields: [episodes.podcastId],
    references: [podcasts.id],
  }),
  transcript: one(transcripts),
  summaries: many(summaries),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
  podcast: one(podcasts, {
    fields: [subscriptions.podcastId],
    references: [podcasts.id],
  }),
}));

export const queueItemsRelations = relations(queueItems, ({ one }) => ({
  user: one(users, { fields: [queueItems.userId], references: [users.id] }),
  episode: one(episodes, {
    fields: [queueItems.episodeId],
    references: [episodes.id],
  }),
}));

export const playbackStateRelations = relations(playbackState, ({ one }) => ({
  episode: one(episodes, {
    fields: [playbackState.episodeId],
    references: [episodes.id],
  }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type Podcast = typeof podcasts.$inferSelect;
export type NewPodcast = typeof podcasts.$inferInsert;
export type Episode = typeof episodes.$inferSelect;
export type NewEpisode = typeof episodes.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type PlaybackState = typeof playbackState.$inferSelect;
export type QueueItem = typeof queueItems.$inferSelect;
export type Download = typeof downloads.$inferSelect;
export type AiJob = typeof aiJobs.$inferSelect;
export type Transcript = typeof transcripts.$inferSelect;
export type Summary = typeof summaries.$inferSelect;

/** Chapter marker, whether parsed from a feed or AI-generated. */
export type Chapter = {
  startTime: number;
  endTime?: number;
  title: string;
  url?: string;
  img?: string;
};

/**
 * One spoken word with its precise timing, from Whisper's word-level output.
 *
 * Present only on AI transcripts: publisher VTT/JSON carries per-line spans at
 * best, never per word. When `words` is absent the caption fill falls back to
 * interpolating across the line (see lib/player/caption-motion.ts); when it is
 * present the fill tracks the actual spoken word and holds still through pauses.
 */
export type TranscriptWord = {
  start: number;
  end: number;
  text: string;
};

/** One transcript segment, used to make citations seekable. */
export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  /** Per-word timings within this line, when the source provides them. */
  words?: TranscriptWord[];
};

/** Power-user per-podcast playback overrides. */
export type PerShowSettings = {
  speed?: number;
  skipSilence?: boolean;
  volumeBoostDb?: number;
  autoQueue?: boolean;
};
