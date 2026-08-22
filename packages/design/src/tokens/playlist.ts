/**
 * Playlist colour.
 *
 * The rest of this design refuses to invent colour — the chrome is warm paper
 * and the *artwork* supplies every hue (see `tint.ts`). A playlist is the one
 * object with no artwork of its own to derive from: it is a thing someone made,
 * not a thing someone published, and until it holds four episodes it has no
 * covers to stack either.
 *
 * So it gets a small closed palette instead of a colour picker. Six is enough
 * to tell six playlists apart at a glance and few enough that every one of them
 * can be fitted by hand to both themes — which is the part a picker cannot do.
 * A free hex field would let someone choose `#FFFF00` for a banner and then
 * find their own title unreadable on it.
 *
 * Each entry carries a gradient pair plus a text colour fitted to it, because
 * a single hex cannot serve both jobs: a banner wants saturation, and the text
 * over it has to be legible against the *dark* end of that gradient specifically.
 *
 * There is no page-wash value here. The playlist's own screen is re-themed the
 * same way a podcast's is — see `ChromeTint` — which derives a whole
 * theme-correct scheme algorithmically from one seed hex (either gradient stop
 * works; only the hue survives the derivation) rather than needing a second
 * hand-fit pair per colour.
 */

export const PLAYLIST_PALETTE_IDS = [
  'ember',
  'ocean',
  'moss',
  'plum',
  'dusk',
  'sand',
] as const;

export type PlaylistPaletteId = (typeof PLAYLIST_PALETTE_IDS)[number];

export type PlaylistPalette = {
  id: PlaylistPaletteId;
  /** Shown beside the swatch, and read aloud in place of it. */
  label: string;
  /** Banner gradient, light end to dark end. */
  from: string;
  to: string;
  /**
   * Text laid over the banner.
   *
   * Fitted against `to`, the darker stop, since the banner's own text sits
   * bottom-left where the gradient has already run dark.
   */
  onBanner: string;
};

export const playlistPalette: Record<PlaylistPaletteId, PlaylistPalette> = {
  ember: {
    id: 'ember',
    label: 'Ember',
    from: '#F0724A',
    to: '#8E2F17',
    onBanner: '#FFF6F1',
  },
  ocean: {
    id: 'ocean',
    label: 'Ocean',
    from: '#4A9BF0',
    to: '#16407E',
    onBanner: '#F1F7FF',
  },
  moss: {
    id: 'moss',
    label: 'Moss',
    from: '#5FB07A',
    to: '#1F5334',
    onBanner: '#F2FAF4',
  },
  plum: {
    id: 'plum',
    label: 'Plum',
    from: '#B072D6',
    to: '#4C2168',
    onBanner: '#FAF3FE',
  },
  dusk: {
    id: 'dusk',
    label: 'Dusk',
    from: '#7A80B8',
    to: '#2E3260',
    onBanner: '#F4F5FC',
  },
  sand: {
    id: 'sand',
    label: 'Sand',
    from: '#D6A85C',
    to: '#7A5316',
    onBanner: '#FFF9EE',
  },
};

/** The palette in the order the picker shows it. */
export const playlistPalettes: PlaylistPalette[] = PLAYLIST_PALETTE_IDS.map(
  (id) => playlistPalette[id],
);

/**
 * Resolve an id that came off the wire.
 *
 * A row written before a palette was renamed — or by a client this server has
 * never met — must still render. Falling back beats rendering a playlist with
 * no banner at all.
 */
export function resolvePlaylistPalette(id: string | null | undefined): PlaylistPalette {
  return (id !== null && id !== undefined && id in playlistPalette
    ? playlistPalette[id as PlaylistPaletteId]
    : playlistPalette.ember)!;
}
