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
} as const satisfies Record<string, IconPath>;

export type IconToken = keyof typeof icon;
