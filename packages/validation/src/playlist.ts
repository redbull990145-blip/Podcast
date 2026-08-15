/**
 * Playlist inputs.
 *
 * Shared so a form rejects what the server would reject, in the same words and
 * at the same length — a title that turns red at 121 characters in the browser
 * and is accepted at 200 by the API is two different products.
 */

import { z } from 'zod';

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
 * How many playlists one account may hold, and how many episodes each may.
 *
 * Guards rather than product limits — nobody curating podcasts hits either.
 * They exist because an unbounded per-user table is a denial-of-service waiting
 * for a script, and because the reorder endpoint rewrites every key it is
 * given, which has to have a ceiling.
 */
export const PLAYLIST_MAX = 100;
export const PLAYLIST_ITEMS_MAX = 500;

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

export const createPlaylistInput = z.object({
  title: playlistTitle,
  description: playlistDescription.optional(),
});
export type CreatePlaylistInput = z.infer<typeof createPlaylistInput>;

/**
 * Editing.
 *
 * Both fields optional, because renaming and re-describing are separate acts
 * and neither should require resending the other. Whether *something* was sent
 * is checked by the route, since an empty patch is a no-op the caller almost
 * certainly did not mean.
 */
export const updatePlaylistInput = z.object({
  title: playlistTitle.optional(),
  description: playlistDescription.optional(),
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
