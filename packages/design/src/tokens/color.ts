/**
 * Colour.
 *
 * Design direction: the chrome is warm paper — a near-neutral ramp that leans
 * amber-brown rather than blue — and the *artwork* supplies the colour. A
 * single ember accent marks the things that are happening: what is playing,
 * how far through it you are, and where the focus ring is. That restraint is
 * what keeps a media app from looking like a dashboard.
 *
 * The ramp used to be cool graphite (`#08080A` → `#FFFFFF`). Warm paper is the
 * one change that carries the whole redesign: cover art is overwhelmingly warm,
 * and a cool chrome behind it makes every cover read as slightly sour. It also
 * gives the light theme somewhere to be that is not white — the light ground is
 * `#FBFAF7` and its resting surface is *darker* than the ground, so a card
 * recedes into the page rather than glaring out of it.
 *
 * Values are hex literals rather than oklch(). Hex is the one format both the
 * browser and React Native render identically, and a cross-platform product
 * that renders two different colours is worse than one that gives up a nicer
 * authoring syntax.
 */

/**
 * Warm paper. The whole UI is built from this.
 *
 * Numbered dark-to-light like the ramp it replaces, so `900` is the dark
 * theme's ground and `0` is white. The gaps between 25/50/75 exist because the
 * light theme spends most of its life in that top eighth — ground, resting
 * surface, hairline and raised card are four distinct values inside twelve
 * points of lightness, and rounding any two of them together collapses the
 * only depth cue the light theme has.
 */
export const paper = {
  1000: '#0A0907',
  950: '#0E0D0B',
  /** Dark ground, and the light theme's ink. */
  900: '#17140F',
  850: '#1B1813',
  800: '#221E18',
  750: '#2A2620',
  700: '#3A342A',
  600: '#4A443F',
  500: '#6A6259',
  // 450 and 350 exist for one reason: `textTertiary` has to clear 4.5:1 on the
  // *darkest* surface of the light theme and the *lightest* surface of the
  // dark one, and neither 400 nor 300 does. Snapping to a neighbour would clear
  // it by making tertiary the same value as secondary, which collapses two
  // roles into one and loses the hierarchy the scale exists to express.
  450: '#726B64',
  400: '#8A827A',
  350: '#928778',
  300: '#A29B94',
  200: '#C4B9A8',
  150: '#D9D2C5',
  100: '#ECE8E1',
  75: '#F3EFE7',
  50: '#F5F1E8',
  /** Light ground. Not white — white is a surface, not a page. */
  25: '#FBFAF7',
  0: '#FFFFFF',
} as const;

/**
 * Ember. The playing state, progress, and focus — almost nowhere else.
 *
 * One hue, two fills. `400` is the accent on a dark ground; on the light ground
 * it only reaches 2.8:1, which fails SC 1.4.11 for a control that has to be
 * visible without a label, so the light theme takes `500`. Same reason the
 * previous palette carried two ambers.
 */
export const ember = {
  200: '#F7C9B6',
  300: '#F19771',
  400: '#F0724A',
  500: '#DC5A34',
  600: '#C55A32',
  700: '#B14E28',
} as const;

/** Status colours, deliberately muted so nothing shouts. */
const status = {
  // Both of these sat a hair under 4.5:1 on the lightest surface of their own
  // theme — 4.47 and 4.49. Close enough to look fine and still be a fail.
  dangerDark: '#E85055',
  dangerLight: '#C62A2F',
  successDark: '#4CB86A',
  successLight: '#2C7A42',
  warningDark: '#E0913C',
  warningLight: '#9A5F16',
} as const;

/**
 * Semantic tokens. Components reference these — never the ramps above.
 * Both themes expose an identical key set so a component never branches
 * on theme.
 */
export type ColorScheme = {
  /** App background, furthest back. */
  bg: string;
  /** Resting surface: rows, cards, the recessed band behind a hero. */
  surface: string;
  /** A surface that sits above another surface. */
  surfaceRaised: string;
  /** Sheets, modals, the expanded player. */
  surfaceOverlay: string;
  /** Pressed/hover wash over any surface. */
  surfaceHover: string;
  surfacePressed: string;

  border: string;
  borderStrong: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  /** Text placed on top of an accent fill. */
  textOnAccent: string;

  /**
   * The maximum-contrast fill: the primary button, and the filled half of a
   * scrubber you are dragging.
   *
   * A separate role from `accent` because this design puts the *weight* of a
   * primary action in ink rather than in colour — Resume is a near-black pill
   * in the light theme and a near-white one in the dark. That leaves the accent
   * free to mean exactly one thing (this is playing), which is what stops an
   * orange button and an orange progress bar from competing to be the thing
   * your eye lands on.
   *
   * It is `textPrimary` and `bg` by value, and named anyway: a button written
   * as `background: textPrimary` reads as a mistake at every call site, and the
   * pair would have to be spelled out again on native.
   */
  ink: string;
  /** Label on an ink fill. */
  textOnInk: string;

  /** Accent as a *fill* (play button, progress). */
  accent: string;
  /** Accent as *text/icon* on the app background, contrast-corrected. */
  accentText: string;
  /** Low-opacity accent wash for selected rows. */
  accentMuted: string;

  danger: string;
  success: string;
  warning: string;

  /** Scrim behind modals and the expanding player. */
  scrim: string;
  /** Skeleton base while content loads. */
  skeleton: string;
};

export const dark: ColorScheme = {
  bg: paper[900],
  surface: paper[850],
  surfaceRaised: paper[800],
  surfaceOverlay: paper[800],
  surfaceHover: 'rgba(255, 255, 255, 0.05)',
  surfacePressed: 'rgba(255, 255, 255, 0.09)',

  border: paper[750],
  // Heavier than it looks like it wants to be. `borderStrong` is the edge of a
  // secondary button and the unfilled half of the progress track, so SC 1.4.11
  // asks 3:1 of it against the ground — a boundary you cannot see is not a
  // boundary. `border` stays a hairline; it is decorative separation, and in
  // this palette it is a solid warm step rather than a white veil, because a
  // white veil over a warm ground desaturates exactly the thing the ground is
  // for.
  borderStrong: 'rgba(241, 234, 217, 0.4)',

  textPrimary: '#F1EAD9',
  textSecondary: paper[200],
  textTertiary: paper[350],
  textOnAccent: paper[900],

  ink: '#F1EAD9',
  textOnInk: paper[900],

  accent: ember[400],
  accentText: ember[300],
  accentMuted: 'rgba(240, 114, 74, 0.16)',

  danger: status.dangerDark,
  success: status.successDark,
  warning: status.warningDark,

  scrim: 'rgba(10, 9, 7, 0.66)',
  skeleton: paper[800],
};

export const light: ColorScheme = {
  bg: paper[25],
  // Darker than the ground, which is the opposite of what the cool palette did.
  // On paper a card is a recess, not a glare: raising every surface towards
  // white is what made the old light theme read as a spreadsheet.
  surface: paper[50],
  surfaceRaised: paper[0],
  surfaceOverlay: paper[0],
  surfaceHover: 'rgba(23, 21, 18, 0.05)',
  surfacePressed: 'rgba(23, 21, 18, 0.08)',

  border: paper[100],
  borderStrong: 'rgba(23, 21, 18, 0.5)',

  textPrimary: paper[900],
  textSecondary: paper[600],
  textTertiary: paper[450],
  // Dark, as in the dark theme. Ember is a light hue and wants a dark label;
  // white on it reaches 3.6:1, a fail on the most-pressed control in the
  // product.
  textOnAccent: paper[900],

  ink: paper[900],
  textOnInk: paper[25],

  accent: ember[500],
  accentText: ember[700],
  accentMuted: 'rgba(220, 90, 52, 0.12)',

  danger: status.dangerLight,
  success: status.successLight,
  warning: status.warningLight,

  scrim: 'rgba(23, 21, 18, 0.4)',
  skeleton: paper[100],
};

export const colorSchemes = { dark, light } as const;
export type ThemeName = keyof typeof colorSchemes;
