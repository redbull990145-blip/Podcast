/**
 * Icon path data.
 *
 * No icon library on either platform. Three icons do not justify a dependency,
 * and a general-purpose icon set arrives with a visual language of its own
 * that quietly overrides the product's.
 *
 * The paths live here rather than in either app because both draw them — the
 * web as inline `<svg>`, Android through `react-native-svg`. Same 24×24 grid,
 * same geometry, so the two platforms cannot drift into having subtly
 * different icons for the same destination.
 */

export type IconPath = string;

/** All drawn on a 24×24 viewBox. */
export const icon = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z',
  search: 'M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Zm5-1.5L20 20',
  library: 'M5 4h3v16H5zM10.5 4h3v16h-3zM17 4.6l2.9.8-4 14.4-2.9-.8z',
  /** A list whose last line is short — the queue running out. */
  queue: 'M4 7h16M4 12h16M4 17h9',
  /** Three sliders, not a gear: this screen is preferences, not machinery. */
  settings: 'M5 7h10M18 7h1M5 12h3M11 12h8M5 17h8M16 17h3M15 5v4M8 10v4M13 15v4',

  play: 'M8 5.5v13l11-6.5z',
  pause: 'M8 5.5h3.2v13H8zM12.8 5.5H16v13h-3.2z',

  /** Skip arrows carry their own numerals in the UI, not in the path. */
  skipBack: 'M11 5 5.5 9.5 11 14M5.5 9.5H14a4.5 4.5 0 0 1 0 9h-3',
  skipForward: 'M13 5l5.5 4.5L13 14M18.5 9.5H10a4.5 4.5 0 0 0 0 9h3',

  chevronDown: 'M6 9.5 12 15.5l6-6',
  check: 'M5 12.5 9.5 17 19 7.5',
  plus: 'M12 5v14M5 12h14',

  /** An arrow coming down onto a shelf — arriving on the device, not leaving. */
  download: 'M12 4v10.5M7.5 10 12 14.5 16.5 10M5 19.5h14',
  /**
   * The same shelf with the arrow already landed, as a tick.
   *
   * Deliberately built from `download`'s bottom line rather than reusing
   * `check`: a download button that swaps a distinct glyph for a bare tick
   * reads as two unrelated controls, where keeping the shelf makes it obvious
   * the state changed rather than the button.
   */
  downloaded: 'M8 10.7 11 13.7 16.5 7.5M5 19.5h14',
  /** Signal arcs with a line through them. */
  offline: 'M2.5 8.5a15.5 15.5 0 0 1 6-3.6M15.5 5A15.5 15.5 0 0 1 21.5 8.5M6 12.3a10 10 0 0 1 3-1.8M15.5 11a10 10 0 0 1 2.5 1.3M9.5 16.1a5 5 0 0 1 5 0M3 3l18 18',
  /** A bin: the only destructive action in the app, and it should look like it. */
  trash: 'M4.5 6.5h15M9.5 6.5V4.5h5v2M7 6.5l.9 12.2a1 1 0 0 0 1 .8h6.2a1 1 0 0 0 1-.8l.9-12.2',
  /** A cross, for stopping something already under way. */
  close: 'M6 6l12 12M18 6 6 18',
  /**
   * An arrow leaving a tray — the mirror of `download`.
   *
   * Deliberately not the three-connected-dots glyph: that mark means "share"
   * only to people who already know it does, and it reads as a graph or a
   * branch to everyone else.
   */
  share: 'M12 4v10.5M7.5 8.5 12 4l4.5 4.5M5 14v5.5h14V14',
} as const satisfies Record<string, IconPath>;

export type IconToken = keyof typeof icon;
