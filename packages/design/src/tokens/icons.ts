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

  /**
   * Skip arrows, drawn as a ring with a gap at the top.
   *
   * The numeral goes *inside* the ring, so the ring has to actually be a ring —
   * one circle, centred on the icon's centre, with nothing else inside it. The
   * previous pair were an arrowhead and an arc that did not share a centre, so
   * the ring sat off to one side and the number landed on top of the stroke
   * rather than in the middle of it, which is why they read as smudges at
   * anything under about 32px.
   *
   * Centre (12,12), radius 8, a 30° gap at the top, and a chevron at the end
   * the motion arrives from — pointing left to go back, right to go forward.
   *
   * The sweep flag is doing real work here, not decoration. Two endpoints and a
   * radius describe *two* circles, and the flags pick which one; get them the
   * wrong way round and the arc is drawn around the other centre, which put the
   * ring at y −11 — almost entirely outside the 24×24 box, so all that survived
   * on screen was the chevron and the whole control read as a stray tick.
   * Large-arc 1 with sweep 1 going right-to-left is the combination that keeps
   * the centre at (12,12); forward is its mirror, so its sweep is 0.
   */
  skipBack: 'M14.07 4.27A8 8 0 1 1 9.93 4.27M9.93 4.27 13 2.4M9.93 4.27 13 6.2',
  skipForward: 'M9.93 4.27A8 8 0 1 0 14.07 4.27M14.07 4.27 11 2.4M14.07 4.27 11 6.2',

  chevronDown: 'M6 9.5 12 15.5l6-6',
  /**
   * The same chevron on its side, for "there is more this way".
   *
   * Drawn rather than produced by rotating `chevronDown` in CSS, because the
   * one place it points the other way is under Arabic — and a transform that
   * has to be undone by a second transform for RTL is how an arrow ends up
   * pointing back at the content it came from.
   */
  chevronRight: 'M9.5 6 15.5 12l-6 6',
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
  /**
   * A speech bubble with two lines of text in it.
   *
   * The mark every media player uses for lyrics and captions, which is the
   * point — a lettermark would need translating to keep meaning anything, and
   * this one is already understood without being read.
   */
  captions: 'M4 5.5h16v11H9.5L5.5 20v-3.5H4zM7.5 9.5h9M7.5 12.5h5.5',

  /**
   * Volume, as a pair rather than a single glyph with a state.
   *
   * The two ends of a volume slider are labels, not controls: the cone alone
   * means "quiet end", the cone with arcs means "loud end". Drawing one icon
   * and animating the arcs in and out would be the same picture doing two
   * different jobs, and the slider already says where the level is.
   */
  volumeLow: 'M4.5 9.5h3L11 6v12l-3.5-3.5h-3z',
  volumeHigh: 'M4.5 9.5h3L11 6v12l-3.5-3.5h-3zM14 9.9a3.3 3.3 0 0 1 0 4.2M16.6 7.6a7 7 0 0 1 0 8.8',
  /** The cone with the arcs struck through — silence, not merely quiet. */
  volumeMuted: 'M4.5 9.5h3L11 6v12l-3.5-3.5h-3zM15 10l4.5 4M19.5 10 15 14',

  /**
   * The sleep timer: a crescent, not a clock face.
   *
   * A clock would be the literal drawing and the wrong one — this control does
   * not tell the time, it says *stop at some point after I have fallen asleep*,
   * and every audio product that has one draws a moon for exactly that reason.
   * It is also the only glyph in this set that has to read at 20px against a
   * photograph, so it is one closed shape rather than a dial with hands that
   * would silt up at that size.
   */
  sleep: 'M20.5 14.4A8.5 8.5 0 0 1 9.6 3.5a8.5 8.5 0 1 0 10.9 10.9Z',
} as const satisfies Record<string, IconPath>;

export type IconToken = keyof typeof icon;
