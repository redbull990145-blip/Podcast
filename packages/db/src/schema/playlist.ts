/**
 * Playlists.
 *
 * A queue answers "what next"; a playlist answers "what for" — long drives, the
 * ones worth a second listen, the four episodes someone recommended. That is
 * the whole justification, and it is a private one: nothing here is shared,
 * published, or collaborative, and there is no `visibility` column waiting for
 * a feature nobody has asked for. Adding one later is one migration.
 *
 * A playlist holds episodes *or* shows, never both — see `kind`. That is two
 * item tables rather than one polymorphic one, which costs a join nobody makes
 * and buys a real foreign key on both sides. A single `item_id` column with a
 * `type` discriminator cannot be referenced, so nothing would stop a row
 * pointing at an episode that was deleted last week.
 *
 * The ordering is the same fractional-key scheme the queue uses, for the same
 * reason: moving an item writes one row rather than renumbering the list, and
 * two devices inserting into the same gap produce different keys instead of
 * fighting over an integer.
 */

import {
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { episodes, podcasts } from './catalog.ts';

/**
 * `bytea`, as a Buffer.
 *
 * Drizzle has no first-class binary column for Postgres, and the alternatives
 * are worse than twenty lines here: base64 in a `text` column inflates every
 * stored banner by a third and has to be decoded on every read, and an
 * out-of-band object store is a second piece of infrastructure — with its own
 * credentials, lifecycle and failure mode — for what is at most one small
 * picture per playlist.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const playlists = pgTable(
  'playlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * `episode` or `podcast`, chosen once and never changed.
     *
     * Defaulted for the migration's sake — every row that existed before this
     * column did was a list of episodes, because that was the only kind there
     * was. New rows are always given one explicitly; the API has no default.
     */
    kind: text('kind').$type<'episode' | 'podcast'>().notNull().default('episode'),

    title: text('title').notNull(),
    description: text('description'),

    // ------------------------------------------------------------- looks --

    /** A palette id from `@cue/design`, never a raw colour. See the palette. */
    color: text('color').notNull().default('ember'),
    /** Which banner is showing. The image, if any, survives switching away. */
    bannerKind: text('banner_kind').$type<'color' | 'image'>().notNull().default('color'),
    bannerText: text('banner_text'),

    /**
     * The page wash for this playlist's own screen. Null leaves it alone.
     *
     * Nullable where `color` is not, because most people want a coloured card
     * and only some want a coloured page — and the difference between those two
     * appetites is exactly what a null expresses.
     */
    backgroundColor: text('background_color'),

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
     *
     * `kind` is not in the index. The Library's tabs filter on it, but a
     * hundred-row ceiling per user means the filter is free once the user's own
     * rows have been found — and putting it second would break the sort.
     */
    index('playlists_user_idx').on(t.userId, t.updatedAt.desc()),
  ],
).enableRLS();

/**
 * The uploaded banner, one row per playlist that has one.
 *
 * Its own table rather than a `bytea` column on `playlists`, because otherwise
 * every read of the playlist list drags a hundred pictures out of the heap to
 * render a hundred titles. Postgres would TOAST them out of line, but the
 * planner still has to be told not to fetch what nobody selected, and the
 * reliable way to tell it that is a separate relation.
 */
export const playlistBanners = pgTable(
  'playlist_banners',
  {
    /** Also the foreign key: a playlist has at most one banner. */
    playlistId: uuid('playlist_id')
      .primaryKey()
      .references(() => playlists.id, { onDelete: 'cascade' }),

    /**
     * Carried even though every stored banner is re-encoded to one format.
     *
     * Serving a stored blob under a guessed content type is how a byte stream
     * gets sniffed into something executable. The column means the response can
     * state what it is holding rather than assert what it hopes it is.
     */
    contentType: text('content_type').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: bytea('bytes').notNull(),

    /**
     * The cache key in the URL.
     *
     * A banner's URL is otherwise `/playlists/:id/banner` forever, which every
     * layer between here and the screen is entitled to cache — so replacing the
     * picture would leave the old one on screen until something expired. This
     * changes on every upload, so the new banner has a URL nothing has seen.
     */
    version: uuid('version').notNull().defaultRandom(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
).enableRLS();

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
).enableRLS();

/**
 * Shows in a podcast playlist.
 *
 * A near-copy of `playlist_items` by shape and an entirely different thing by
 * meaning. Sharing one table would mean a nullable `episode_id` beside a
 * nullable `podcast_id` and a check constraint asserting exactly one is set —
 * which is a polymorphic association with extra steps, and would still let a
 * podcast row land in an episode playlist.
 */
export const playlistPodcasts = pgTable(
  'playlist_podcasts',
  {
    playlistId: uuid('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    podcastId: uuid('podcast_id')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),

    sortKey: text('sort_key').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('playlist_podcasts_playlist_podcast_key').on(t.playlistId, t.podcastId),
    index('playlist_podcasts_order_idx').on(t.playlistId, t.sortKey),
    index('playlist_podcasts_podcast_idx').on(t.podcastId),
  ],
).enableRLS();

export type PlaylistRow = typeof playlists.$inferSelect;
export type PlaylistItemRow = typeof playlistItems.$inferSelect;
export type PlaylistPodcastRow = typeof playlistPodcasts.$inferSelect;
export type PlaylistBannerRow = typeof playlistBanners.$inferSelect;
