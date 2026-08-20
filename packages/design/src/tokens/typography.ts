/**
 * Typography.
 *
 * **Geist for the interface, the platform behind it.** Geist is the face this
 * design is drawn in: a grotesque with flat terminals and very even colour,
 * which is what lets the same family carry a 34px page title and an 11px
 * eyebrow without the small sizes going muddy. Its numerals are why it survives
 * a media app — durations and timestamps sit in columns everywhere here.
 *
 * Geist ships Latin, Latin-Extended, Cyrillic and Vietnamese, and stops. This
 * app has to render Hindi, Arabic, Japanese and Korean, and **those fall
 * through to the platform's own UI face**, one codepoint at a time, exactly as
 * they did before — the previous face was Inter loaded with the `latin` and
 * `latin-ext` subsets, which does not carry them either. The i18n commitment is
 * about what actually renders on the reader's screen, and for those scripts
 * that has always been the system font. Naming it explicitly in the stack is
 * the change; pretending a webfont was covering it would be the regression.
 *
 * `mono` is Geist Mono, and it is a genuine second job rather than decoration:
 * elapsed and remaining times, chapter marks and scrubber labels are read as
 * *positions*, and a proportional face makes 1:04:22 a different width from
 * 1:14:22 while the same audio plays. Everything that is not a timecode stays
 * in the sans.
 *
 * Sizes are in px; both platforms consume the same numbers. Line heights are
 * absolute rather than unitless so that a paragraph and a heading of the same
 * size never disagree between web and native.
 */

export const fontFamily = {
  /** UI text, display text, all of it. */
  sans: 'Geist',
  /** Timecodes, durations, chapter marks. */
  mono: 'Geist Mono',
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
 *
 * The scale came down at the top end. `display` was 40/bold and is now 34/
 * semibold, because 40px bold at the head of every screen was announcing the
 * tab you had just pressed — the size was doing the work a *sentence* should
 * do. At 34 it is still unmistakably the page title and it stops shouting the
 * word "Library" at someone who chose Library.
 */
export const text = {
  /** Page title. Used at most once per screen. */
  display: {
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.032,
    fontWeight: fontWeight.semibold,
    family: 'sans',
  },
  /** A title inside a page — an episode, a show. */
  title1: {
    fontSize: 28,
    lineHeight: 33,
    letterSpacing: -0.026,
    fontWeight: fontWeight.semibold,
    family: 'sans',
  },
  /** Section header. */
  title2: {
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.02,
    fontWeight: fontWeight.semibold,
    family: 'sans',
  },
  /** Card/row title. */
  title3: {
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.015,
    fontWeight: fontWeight.semibold,
    family: 'sans',
  },
  /** Emphasised body — episode titles in a list. */
  bodyStrong: {
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.01,
    fontWeight: fontWeight.medium,
    family: 'sans',
  },
  /** Default reading size. Show notes, transcripts. */
  body: {
    fontSize: 15,
    lineHeight: 24,
    letterSpacing: -0.005,
    fontWeight: fontWeight.regular,
    family: 'sans',
  },
  /** Secondary metadata under a title. */
  callout: {
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: -0.002,
    fontWeight: fontWeight.regular,
    family: 'sans',
  },
  /** Counts, labels, anything that has to stay quiet and stay legible. */
  caption: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0,
    fontWeight: fontWeight.medium,
    family: 'sans',
  },
  /**
   * Timestamps and durations.
   *
   * The one token set in the mono face. Same size as `caption` so a duration
   * and the label beside it sit on the same line without one of them looking
   * like a different thought.
   */
  timecode: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0,
    fontWeight: fontWeight.medium,
    family: 'mono',
  },
  /** Uppercase eyebrow labels. Tracking opens up as size drops. */
  overline: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.08,
    fontWeight: fontWeight.medium,
    family: 'sans',
  },
} as const satisfies Record<string, TextStyle>;

export type TextToken = keyof typeof text;
