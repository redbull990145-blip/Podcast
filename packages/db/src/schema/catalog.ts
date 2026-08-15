/**
 * The catalog: shows, episodes, and how they're categorised.
 *
 * This half of the schema holds no user data, which is why it can be read
 * without a session and cached hard. User-scoped tables live separately.
 *
 * Timestamps are `timestamptz` and surface as JS `Date` here. Conversion to
 * ISO strings happens once, at the API serialisation boundary — the database
 * layer should not be in the business of formatting.
 */

import {
  boolean,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const podcasts = pgTable(
  'podcasts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Canonical RSS URL — the identity of a show. Normalised before insert
     * (lowercased host, no trailing slash, tracking params stripped) so the
     * same feed reached by two URLs doesn't become two shows.
     */
    feedUrl: text('feed_url').notNull(),

    title: text('title').notNull(),
    author: text('author'),
    description: text('description'),
    artworkUrl: text('artwork_url'),
    websiteUrl: text('website_url'),

    /** BCP-47. Drives language-aware discovery and search filtering. */
    language: text('language'),
    explicit: boolean('explicit').notNull().default(false),

    /**
     * Dominant colour of the artwork, as `#RRGGBB`.
     *
     * Extracted once at ingest rather than in the client: podcast artwork is
     * served from arbitrary CDNs with no CORS headers, so a browser canvas
     * cannot read its pixels at all, and doing it per-device would repeat the
     * work on every phone. One extraction feeds both platforms.
     */
    accentColor: text('accent_color'),

    /** PodcastIndex's id, when the show came from there. Lets us re-sync. */
    podcastIndexId: integer('podcastindex_id'),

    /**
     * How this show got into the catalogue.
     *
     * `seed` is a show the operator put here; `directory` is one a visitor
     * pulled in from search. The catalogue is shared — anyone's search result
     * becomes a row everyone can see — so without this there is no way to tell
     * the shows we chose to offer from the long tail somebody typed in once.
     *
     * Written on insert only. A seeded show that somebody later searches for is
     * still a seeded show, and the upsert leaves the column alone precisely so
     * that a refresh cannot rewrite its own history.
     */
    source: text('source', { enum: ['seed', 'directory'] })
      .notNull()
      .default('seed'),

    // -- ingest bookkeeping ------------------------------------------------
    /**
     * `ETag` and `Last-Modified` from the last successful fetch. Sending these
     * back as conditional headers means an unchanged feed costs a 304 and no
     * body — the difference between polling thousands of feeds being free and
     * being the main expense.
     */
    etag: text('etag'),
    lastModified: text('last_modified'),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    lastPublishedAt: timestamp('last_published_at', { withTimezone: true }),
    episodeCount: integer('episode_count'),

    /**
     * Consecutive failures. Used to back off a dead feed rather than
     * retrying it on every cycle forever.
     */
    fetchFailureCount: smallint('fetch_failure_count').notNull().default(0),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('podcasts_feed_url_key').on(t.feedUrl),
    uniqueIndex('podcasts_podcastindex_id_key').on(t.podcastIndexId),
    index('podcasts_language_idx').on(t.language),
    /** Drives "which feeds are due a refresh". */
    index('podcasts_refresh_idx').on(t.lastFetchedAt),
  ],
);

export const episodes = pgTable(
  'episodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    podcastId: uuid('podcast_id')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),

    /** Publisher's `<guid>`. Unique per show, never globally. */
    guid: text('guid').notNull(),

    title: text('title').notNull(),
    description: text('description'),
    descriptionHtml: text('description_html'),

    /** Publisher's audio URL. We link to it; we never store or proxy it. */
    audioUrl: text('audio_url').notNull(),
    audioType: text('audio_type'),
    audioLengthBytes: integer('audio_length_bytes'),

    /**
     * Nullable on purpose — plenty of feeds omit `<itunes:duration>`. The
     * player learns the real duration on load. UI must handle null rather
     * than rendering a scrubber against a fake zero.
     */
    durationSec: integer('duration_sec'),

    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    artworkUrl: text('artwork_url'),

    /**
     * Dominant colour of *this episode's* artwork, as `#RRGGBB`.
     *
     * Separate from the show's colour because episode covers genuinely differ —
     * across this catalogue, 5,008 episodes carry their own art spanning 2,804
     * distinct images, so inheriting one colour per show would paint nine
     * hundred episodes of a daily news podcast the same blue.
     *
     * Null until someone plays the episode. Filling it at ingest would mean
     * fetching and analysing an image for every episode of every feed on the
     * chance it is opened; instead the first play pays for it once and everyone
     * after reads the stored value. Until then the show's colour stands in,
     * which is a good approximation and never an empty screen.
     */
    accentColor: text('accent_color'),

    episodeNumber: integer('episode_number'),
    seasonNumber: integer('season_number'),
    explicit: boolean('explicit').notNull().default(false),

    /** Publisher-provided transcript from `<podcast:transcript>`, if any. */
    transcriptUrl: text('transcript_url'),
    transcriptType: text('transcript_type'),

    ...timestamps,
  },
  (t) => [
    /** Re-ingesting a feed must update episodes, not duplicate them. */
    uniqueIndex('episodes_podcast_guid_key').on(t.podcastId, t.guid),

    /**
     * Shaped to match the cursor-paginated episode list exactly:
     * `WHERE podcast_id = $1 AND (published_at, id) < ($2, $3)
     *  ORDER BY published_at DESC, id DESC`.
     * With this index that query is an index-only range scan at any offset,
     * which is what stops page 50 of a 900-episode show being slower than
     * page 1.
     */
    index('episodes_podcast_published_idx').on(
      t.podcastId,
      t.publishedAt.desc(),
      t.id.desc(),
    ),

    /** Global "new releases" across all subscribed shows. */
    index('episodes_published_idx').on(t.publishedAt.desc(), t.id.desc()),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: smallint('id').primaryKey().generatedAlwaysAsIdentity(),
    /** Stable machine name, e.g. `true-crime`. */
    slug: text('slug').notNull(),
    /** Display name in English; translated in the client via the i18n catalog. */
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('categories_slug_key').on(t.slug)],
);

export const podcastCategories = pgTable(
  'podcast_categories',
  {
    podcastId: uuid('podcast_id')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    categoryId: smallint('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('podcast_categories_pkey').on(t.podcastId, t.categoryId),
    /** Browse-by-category reads this direction. */
    index('podcast_categories_category_idx').on(t.categoryId),
  ],
);

export type PodcastRow = typeof podcasts.$inferSelect;
export type NewPodcastRow = typeof podcasts.$inferInsert;
export type EpisodeRow = typeof episodes.$inferSelect;
export type NewEpisodeRow = typeof episodes.$inferInsert;
export type CategoryRow = typeof categories.$inferSelect;
