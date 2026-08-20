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

/**
 * Onyx. The other dark theme.
 *
 * `dark` leans amber-brown on purpose — it is the warm-paper direction, and
 * cover art sits better on it than on anything cool. But warmth is a taste, and
 * on an OLED panel in a dark room a brown ground is visibly *lit* in a way some
 * people read as a screen that failed to turn all the way off. This is the same
 * design with the warmth taken out: a neutral ramp, an eighth of a step from
 * black, everything else identical.
 *
 * Deliberately not `#000000`. Pure black is where a dark theme stops being a
 * surface: elevation disappears, because nothing can sit *below* black, so
 * every card, sheet and row edge has to be drawn with a border instead of a
 * value — and on OLED the pixels genuinely switch off, which turns scrolling
 * into visible smearing. `#0C0C0E` keeps the ground a ground.
 *
 * The accent, the status colours and the text roles are shared with `dark`
 * rather than re-picked. They are already the lightest things in the palette
 * and this ground is *darker* than the one they were verified against, so
 * every pair they belong to gets more contrast, not less — and a second set of
 * near-whites would be two constants that have to be edited together forever.
 */
export const onyx: ColorScheme = {
  bg: '#0C0C0E',
  surface: '#151517',
  surfaceRaised: '#1B1B1E',
  surfaceOverlay: '#1B1B1E',
  surfaceHover: 'rgba(255, 255, 255, 0.06)',
  surfacePressed: 'rgba(255, 255, 255, 0.10)',

  border: '#26262A',
  borderStrong: 'rgba(235, 235, 240, 0.4)',

  textPrimary: '#F2F2F4',
  textSecondary: '#C2C2C8',
  textTertiary: '#8A8A93',
  textOnAccent: '#0C0C0E',

  ink: '#F2F2F4',
  textOnInk: '#0C0C0E',

  accent: ember[400],
  accentText: ember[300],
  accentMuted: 'rgba(240, 114, 74, 0.18)',

  danger: status.dangerDark,
  success: status.successDark,
  warning: status.warningDark,

  scrim: 'rgba(0, 0, 0, 0.7)',
  skeleton: '#1B1B1E',
};

/**
 * The stage: the expanded player, and nothing else.
 *
 * Not a theme — a *place*. Everything behind this palette is the artwork
 * itself: the cover blurred past recognition, a wash taken from its dominant
 * colour, and a black gradient over the lot. That ground is different for every
 * episode and cannot be predicted, which is exactly why the foreground must not
 * be derived from anything.
 *
 * So it is white. Not `dark`'s `#F1EAD9`, which is a warm cream that picks up
 * whatever hue is behind it and reads as *tinted by the cover* — the specific
 * complaint that produced this scheme — and not the theme's own tokens, which
 * put near-black text on a near-black backdrop for anybody running the light
 * theme. One fixed set of neutral whites, in both themes, under every cover.
 *
 * The accent is white too. Elsewhere the ember accent means *this is what is
 * playing*; on a screen whose entire subject is the thing that is playing, that
 * distinction has nothing left to distinguish, and a saturated progress bar in
 * front of a cover it was sampled from is two colours arguing.
 *
 * Opaque values rather than translucent whites. Alpha over a photograph tracks
 * whatever is underneath it, so a caption sitting over the bright corner of one
 * cover and the dark corner of another is two different colours — which is the
 * problem this exists to solve, reintroduced one layer down.
 */
export const stage: ColorScheme = {
  bg: '#0A0A0A',
  surface: '#141414',
  surfaceRaised: '#1C1C1C',
  surfaceOverlay: '#1C1C1C',
  surfaceHover: 'rgba(255, 255, 255, 0.12)',
  surfacePressed: 'rgba(255, 255, 255, 0.2)',

  border: 'rgba(255, 255, 255, 0.16)',
  borderStrong: 'rgba(255, 255, 255, 0.45)',

  textPrimary: '#FFFFFF',
  textSecondary: '#E2E2E2',
  textTertiary: '#B4B4B4',
  textOnAccent: '#0A0A0A',

  ink: '#FFFFFF',
  textOnInk: '#0A0A0A',

  accent: '#FFFFFF',
  accentText: '#FFFFFF',
  accentMuted: 'rgba(255, 255, 255, 0.18)',

  // Lighter than the themes' own status colours: these land on a photograph
  // rather than on a known surface, and the error line under the transport is
  // the one piece of text on this screen that must never be missed.
  danger: '#FF9A9A',
  success: '#8CE0A6',
  warning: '#F2C27A',

  scrim: 'rgba(0, 0, 0, 0.66)',
  skeleton: 'rgba(255, 255, 255, 0.1)',
};

/**
 * The schemes a listener can actually choose between.
 *
 * `stage` is absent because it is not a choice — it belongs to one screen and
 * applies under every theme. Everything in here is offered in Settings, and
 * everything in here is held to AA by `contrast.test.ts`.
 */
export const colorSchemes = { dark, onyx, light } as const;
export type ThemeName = keyof typeof colorSchemes;
