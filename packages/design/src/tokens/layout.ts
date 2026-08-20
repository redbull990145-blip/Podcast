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

/**
 * Radii came down across the board — `md` 10 → 8, `lg` 14 → 12, `xl` 20 → 16.
 *
 * A pill is now a pill (`full`, and every button in this design is one) and
 * everything else is a *panel*, which is a much squarer thing than the old
 * scale allowed. The failure mode the previous note warned about turned out to
 * be reachable from the other direction: with `lg` at 14 and `xl` at 20 in
 * play, a card and a sheet and a cover all had noticeably round corners and
 * the difference between them stopped being legible. Softening the top of the
 * scale is what lets the pills read as the only genuinely round thing on
 * screen.
 */
export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

/**
 * Artwork corners scale with artwork size. A 44px thumbnail with a 16px radius
 * reads as a blob; a 320px cover with a 6px radius reads as a sticker.
 */
export const artworkRadius = {
  /** ≤56px — list thumbnails, mini player. */
  sm: 5,
  /** 57–160px — grid tiles, queue rows. */
  md: 8,
  /** 161–280px — podcast header. */
  lg: 10,
  /** >280px — expanded player cover. */
  xl: 12,
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
  sm: '0 1px 2px rgba(10, 9, 7, 0.14), 0 8px 24px -16px rgba(10, 9, 7, 0.34)',
  /** Mini player, sticky headers. */
  md: '0 12px 24px -12px rgba(10, 9, 7, 0.4)',
  /** Menus, popovers. */
  lg: '0 24px 48px -24px rgba(10, 9, 7, 0.46)',
  /** Expanded player, modal sheets. */
  xl: '0 40px 80px -40px rgba(10, 9, 7, 0.55), 0 12px 24px -12px rgba(10, 9, 7, 0.4)',
  /** Artwork, which floats on its own colour rather than on a surface. */
  artwork: '0 20px 40px -20px rgba(10, 9, 7, 0.45)',
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
  artwork: { elevation: 12, shadowOpacity: 0.45, shadowRadius: 40, shadowOffset: { width: 0, height: 20 } },
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
  /**
   * The desktop navigation rail.
   *
   * A number three components have to agree on — the rail itself, the content
   * gutter that clears it, and the player bar, which starts where the rail ends
   * so the mini artwork lines up with the page's first column rather than
   * floating in the gutter. It was 240 and written out by hand in each of them;
   * widening it to 260 for the "Your shows" list is exactly the kind of change
   * that would otherwise have been applied in two places out of three.
   */
  sidebar: 260,
  /**
   * The same rail, collapsed to icons.
   *
   * 72, not 56: the rows keep their 40px round hit target and their 16px of
   * gutter either side, so collapsing changes what the rail *says* and not how
   * it is touched. Narrower than this and the icons start sitting on the window
   * edge, which reads as the rail having been clipped rather than folded.
   */
  sidebarCollapsed: 72,
  /** Transcripts and show notes: ~76 characters at body size. */
  prose: 720,
  /** Main app column. */
  content: 1440,
  /** Lists that are mostly rows and want the room — queue, playlists. */
  wide: 1680,
} as const;
