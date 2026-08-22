/**
 * Playlist inputs.
 *
 * Shared so a form rejects what the server would reject, in the same words and
 * at the same length — a title that turns red at 121 characters in the browser
 * and is accepted at 200 by the API is two different products.
 */

import { z } from 'zod';

/**
 * What a playlist holds.
 *
 * The distinction is not bookkeeping. "Four episodes someone recommended" and
 * "the shows I keep meaning to start" are different objects: one is an ordered
 * listening session with a play-all button, the other is a shelf. Letting a
 * single list hold both would give it a play-all that can only play half of
 * itself, and a count that means nothing.
 *
 * So it is fixed at creation and never changes. A playlist that could switch
 * kinds would have to decide what happens to the items that no longer fit, and
 * every answer to that is worse than asking one question up front.
 */
export const PLAYLIST_KINDS = ['episode', 'podcast'] as const;
export type PlaylistKind = (typeof PLAYLIST_KINDS)[number];
export const playlistKind = z.enum(PLAYLIST_KINDS);

/**
 * The six banner colours, by id.
 *
 * Ids rather than hex on the wire, so the actual colours stay in `@cue/design`
 * where both platforms read them and where each one is fitted to both themes.
 * A stored hex would be a light-theme decision frozen into a database row.
 */
export const PLAYLIST_COLORS = ['ember', 'ocean', 'moss', 'plum', 'dusk', 'sand'] as const;
export type PlaylistColor = (typeof PLAYLIST_COLORS)[number];
export const playlistColor = z.enum(PLAYLIST_COLORS);

/** Whether the banner is a colour this palette owns, or an uploaded picture. */
export const PLAYLIST_BANNER_KINDS = ['color', 'image'] as const;
export type PlaylistBannerKind = (typeof PLAYLIST_BANNER_KINDS)[number];
export const playlistBannerKind = z.enum(PLAYLIST_BANNER_KINDS);

/**
 * Long enough for a real name and nothing more.
 *
 * Playlist titles are read in a list of tiles at one or two lines. A limit of
 * 120 is generous for "Long drives" and short of the point where a title
 * becomes a description someone put in the wrong field.
 */
export const PLAYLIST_TITLE_MAX = 120;
export const PLAYLIST_DESCRIPTION_MAX = 500;

/**
 * The line written across the banner.
 *
 * Much shorter than the title, because it is set large over artwork and wraps
 * to at most two lines at the banner's height. This is a caption in the design
 * sense — "Vol. 3", "for the drive" — not a second description.
 */
export const PLAYLIST_BANNER_TEXT_MAX = 48;

/**
 * How many playlists one account may hold, and how many items each may.
 *
 * Guards rather than product limits — nobody curating podcasts hits either.
 * They exist because an unbounded per-user table is a denial-of-service waiting
 * for a script, and because the reorder endpoint rewrites every key it is
 * given, which has to have a ceiling.
 */
export const PLAYLIST_MAX = 100;
export const PLAYLIST_ITEMS_MAX = 500;

/**
 * The banner upload's ceiling, and what it may be.
 *
 * Five megabytes is a phone photo straight off the camera roll without being a
 * RAW file. The server re-encodes everything it accepts down to a bounded WebP
 * anyway, so this bound exists to cap what has to be read before that decision
 * can be made, not to cap what is stored.
 *
 * SVG is deliberately absent. It is a document format that executes script, and
 * accepting one as an image is a stored-XSS hole wearing a picture's clothes.
 */
export const PLAYLIST_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PLAYLIST_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
] as const;

/** What the stored banner is re-encoded to. Wide, because it renders as a band. */
export const PLAYLIST_IMAGE_WIDTH = 1600;
export const PLAYLIST_IMAGE_HEIGHT = 500;

export const playlistTitle = z
  .string()
  .trim()
  .min(1, 'Give the playlist a name')
  .max(PLAYLIST_TITLE_MAX, 'That name is too long');

export const playlistDescription = z
  .string()
  .trim()
  .max(PLAYLIST_DESCRIPTION_MAX, 'That description is too long')
  // An empty box means "no description", not an empty string in the database.
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

export const playlistBannerText = z
  .string()
  .trim()
  .max(PLAYLIST_BANNER_TEXT_MAX, 'That is too long to sit on the banner')
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

export const createPlaylistInput = z.object({
  title: playlistTitle,
  /**
   * Required, with no default.
   *
   * A default would quietly make every playlist an episode playlist, which is
   * exactly the guess this field exists to stop the product from making — the
   * whole point is that someone is asked before the list exists.
   */
  kind: playlistKind,
  description: playlistDescription.optional(),
  color: playlistColor.optional(),
  bannerText: playlistBannerText.optional(),
});
export type CreatePlaylistInput = z.infer<typeof createPlaylistInput>;

/**
 * Editing.
 *
 * Every field optional, because renaming, re-describing and re-colouring are
 * separate acts and none should require resending the others. Whether
 * something was sent at all is checked by the route, since an empty patch is a
 * no-op the caller almost certainly did not mean.
 *
 * `kind` is not here. See `PLAYLIST_KINDS`.
 */
export const updatePlaylistInput = z.object({
  title: playlistTitle.optional(),
  description: playlistDescription.optional(),
  color: playlistColor.optional(),
  /**
   * Which banner to show — not which one exists.
   *
   * Switching back to `color` leaves the uploaded image in place, so someone
   * who tries a colour and changes their mind gets their picture back rather
   * than having to find the file again. Clearing it for good is its own DELETE.
   */
  bannerKind: playlistBannerKind.optional(),
  bannerText: playlistBannerText.optional(),
  /**
   * The page wash behind this playlist's own screen.
   *
   * Nullable and separate from `color`, because "give the banner a colour" and
   * "tint the whole page" are different appetites: most people want the first
   * and only some want the second, and `null` is what "leave the page alone"
   * has to be able to say.
   */
  backgroundColor: playlistColor.nullable().optional(),
});
export type UpdatePlaylistInput = z.infer<typeof updatePlaylistInput>;

export const addToPlaylistInput = z.object({
  episodeId: z.uuid(),
  /**
   * Where it lands. Default is the end, which is what "add to playlist" means
   * everywhere — the top is for the case where someone is building a list they
   * are about to play.
   */
  position: z.enum(['start', 'end']).optional(),
});
export type AddToPlaylistInput = z.infer<typeof addToPlaylistInput>;

export const addPodcastToPlaylistInput = z.object({
  podcastId: z.uuid(),
  position: z.enum(['start', 'end']).optional(),
});
export type AddPodcastToPlaylistInput = z.infer<typeof addPodcastToPlaylistInput>;

/**
 * Reordering takes the whole intended order rather than a move.
 *
 * That makes the operation idempotent: replaying it cannot walk an episode
 * twice down the list the way a relative "move down" would, and two devices
 * disagreeing about the previous order cannot compound.
 */
export const reorderPlaylistInput = z.object({
  episodeIds: z.array(z.uuid()).min(1).max(PLAYLIST_ITEMS_MAX),
});
export type ReorderPlaylistInput = z.infer<typeof reorderPlaylistInput>;

export const reorderPlaylistPodcastsInput = z.object({
  podcastIds: z.array(z.uuid()).min(1).max(PLAYLIST_ITEMS_MAX),
});
export type ReorderPlaylistPodcastsInput = z.infer<typeof reorderPlaylistPodcastsInput>;
