/**
 * Spacing, radii, and elevation.
 *
 * Spacing is a 4px grid. Radii are deliberately modest — the brief's
 * "huge rounded rectangles everywhere" failure mode comes from a single
 * oversized radius applied to everything, so radius here scales with the size
 * of the thing it is applied to.
 */

export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

export const radius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

/**
 * Artwork corners scale with artwork size. A 44px thumbnail with a 16px radius
 * reads as a blob; a 320px cover with a 6px radius reads as a sticker.
 */
export const artworkRadius = {
  /** ≤56px — list thumbnails, mini player. */
  sm: 6,
  /** 57–160px — grid tiles, queue rows. */
  md: 10,
  /** 161–280px — podcast header. */
  lg: 14,
  /** >280px — expanded player cover. */
  xl: 18,
} as const;

/**
 * Depth. In dark mode most of the depth comes from surface lightness stepping
 * up, not from shadow — shadows on a near-black background are close to
 * invisible and just cost paint time. Shadows earn their place on genuinely
 * floating things: the player, sheets, menus.
 */
export const elevation = {
  none: 'none',
  /** Resting card lift. */
  sm: '0 1px 2px rgba(0, 0, 0, 0.24)',
  /** Mini player, sticky headers. */
  md: '0 4px 12px rgba(0, 0, 0, 0.28)',
  /** Menus, popovers. */
  lg: '0 12px 32px rgba(0, 0, 0, 0.36)',
  /** Expanded player, modal sheets. */
  xl: '0 24px 64px rgba(0, 0, 0, 0.44)',
} as const;

/**
 * React Native has no box-shadow; it needs discrete props. Same visual
 * intent, expressed in the only vocabulary the platform has.
 */
export const nativeElevation = {
  none: { elevation: 0, shadowOpacity: 0 },
  sm: { elevation: 1, shadowOpacity: 0.24, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  md: { elevation: 4, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  lg: { elevation: 10, shadowOpacity: 0.36, shadowRadius: 32, shadowOffset: { width: 0, height: 12 } },
  xl: { elevation: 20, shadowOpacity: 0.44, shadowRadius: 64, shadowOffset: { width: 0, height: 24 } },
} as const;

/** Minimum hit target. Below this, a control is a bug on a touch device. */
export const hitSlop = { minTarget: 44 } as const;

/**
 * Content width caps.
 *
 * Two jobs, and they pull in opposite directions. `prose` is a reading measure
 * — a line much past eighty characters makes the eye lose its place on the
 * return sweep, so it stays capped however wide the window gets. `content` is
 * the page's frame, and its only job is to stop a layout stretching to the
 * width of an ultrawide monitor; it should otherwise get out of the way.
 *
 * `content` was 1180, which on a 1920 screen left roughly a third of the
 * usable width empty next to a page that had plenty to put there. Widened so
 * the frame follows the window rather than the paragraph.
 *
 * `wide` is new only in the sense of being *defined*: two screens already
 * asked for `--measure-wide`, and because nothing declared it the variable
 * resolved to nothing and `max-width` was dropped altogether. Those pages have
 * been running uncapped — visibly so next to a capped one, which is most of
 * why the app looked inconsistent from screen to screen.
 */
export const measure = {
  /** Transcripts and show notes: ~76 characters at body size. */
  prose: 720,
  /** Main app column. */
  content: 1440,
  /** Lists that are mostly rows and want the room — queue, playlists. */
  wide: 1680,
} as const;
