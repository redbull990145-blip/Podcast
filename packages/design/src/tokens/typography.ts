/**
 * Typography.
 *
 * **One family.** Inter, at every size on both platforms. Variable, superb
 * hinting at small sizes, and the widest script coverage of any free sans —
 * which matters because this app has to render Hindi, Arabic, Japanese and
 * Korean without falling apart.
 *
 * This used to pair Inter with Instrument Serif on page titles, for an
 * editorial voice. In practice the serif appeared exactly once per screen, on
 * an `<h1>` sitting directly above sans-serif everything, and it did not read
 * as a considered pairing — it read as two fonts. A second family earns its
 * place by doing a job the first cannot, and setting seven page titles is not
 * that job. Dropping it also drops a whole webfont from every page load.
 *
 * The display size keeps its scale and gains weight, because what the serif
 * was really contributing at 40px was presence, and in a sans that comes from
 * weight rather than from the letterforms.
 *
 * Sizes are in px; both platforms consume the same numbers. Line heights are
 * absolute rather than unitless so that a paragraph and a heading of the same
 * size never disagree between web and native.
 */

export const fontFamily = {
  /** UI text, display text, all of it. */
  sans: 'Inter',
  /** Tabular numerals for timestamps and durations. */
  mono: 'ui-monospace',
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export type TextStyle = {
  fontSize: number;
  lineHeight: number;
  /** em, applied as `letterSpacing` on native and `letter-spacing` on web. */
  letterSpacing: number;
  fontWeight: (typeof fontWeight)[keyof typeof fontWeight];
  family: keyof typeof fontFamily;
};

/**
 * Optical sizing done by hand: the larger the type, the tighter the tracking.
 * This is the single biggest difference between typography that looks designed
 * and typography that looks defaulted.
 */
export const text = {
  /** Page title. Used at most once per screen. */
  display: {
    fontSize: 40,
    lineHeight: 44,
    // Tighter than title1 because tracking should close as size grows, and
    // bold rather than regular: at this size a regular sans reads as a
    // paragraph that got bigger rather than as a title.
    letterSpacing: -0.024,
    fontWeight: fontWeight.bold,
    family: 'sans',
  },
  /** Screen title. */
  title1: {
    fontSize: 27,
    lineHeight: 32,
    letterSpacing: -0.018,
    fontWeight: fontWeight.semibold,
    family: 'sans',
  },
  /** Section header. */
  title2: {
    fontSize: 21,
    lineHeight: 27,
    letterSpacing: -0.014,
    fontWeight: fontWeight.semibold,
    family: 'sans',
  },
  /** Card/row title. */
  title3: {
    fontSize: 17,
    lineHeight: 23,
    letterSpacing: -0.009,
    fontWeight: fontWeight.semibold,
    family: 'sans',
  },
  /** Emphasised body — episode titles in a list. */
  bodyStrong: {
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.005,
    fontWeight: fontWeight.medium,
    family: 'sans',
  },
  /** Default reading size. Show notes, transcripts. */
  body: {
    fontSize: 15,
    lineHeight: 23,
    letterSpacing: -0.005,
    fontWeight: fontWeight.regular,
    family: 'sans',
  },
  /** Secondary metadata under a title. */
  callout: {
    fontSize: 13.5,
    lineHeight: 19,
    letterSpacing: -0.002,
    fontWeight: fontWeight.regular,
    family: 'sans',
  },
  /** Timestamps, durations, counts. */
  caption: {
    fontSize: 12.5,
    lineHeight: 16,
    letterSpacing: 0,
    fontWeight: fontWeight.medium,
    family: 'sans',
  },
  /** Uppercase eyebrow labels. Tracking opens up as size drops. */
  overline: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.055,
    fontWeight: fontWeight.semibold,
    family: 'sans',
  },
} as const satisfies Record<string, TextStyle>;

export type TextToken = keyof typeof text;
