/**
 * Colour.
 *
 * Design direction: the chrome is achromatic graphite and the *artwork*
 * supplies the colour. A single warm accent marks one thing — what is playing —
 * plus focus rings. That restraint is what keeps a media app from looking like
 * a dashboard.
 *
 * Values are hex literals rather than oklch(). Hex is the one format both the
 * browser and React Native render identically, and a cross-platform product
 * that renders two different colours is worse than one that gives up a nicer
 * authoring syntax.
 */

/** Cool-leaning graphite. The whole UI is built from this. */
export const graphite = {
  1000: '#08080A',
  950: '#0D0D10',
  900: '#131317',
  850: '#191920',
  800: '#202028',
  750: '#292932',
  700: '#33333E',
  600: '#45454F',
  500: '#5C5C68',
  // 450 and 350 exist for one reason: `textTertiary` has to clear 4.5:1 on the
  // lightest surface of its own theme, and neither 400 nor its neighbours do.
  // Snapping to 300 (dark) or 500 (light) would clear it — by making tertiary
  // the same value as secondary, which collapses two roles into one and loses
  // the hierarchy the scale exists to express.
  450: '#6B6B78',
  400: '#7B7B87',
  350: '#8D8D98',
  300: '#9E9EA9',
  200: '#C3C3CC',
  150: '#D9D9E0',
  100: '#E9E9EE',
  50: '#F5F5F8',
  0: '#FFFFFF',
} as const;

/** Warm amber. Used for the playing state and focus — almost nowhere else. */
export const amber = {
  200: '#F7DDB0',
  300: '#F2C888',
  400: '#EBB161',
  500: '#DE9A3F',
  600: '#BE7C28',
  700: '#96601D',
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
  /** Resting surface: rows, cards, inputs. */
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
  bg: graphite[1000],
  surface: graphite[950],
  surfaceRaised: graphite[900],
  surfaceOverlay: graphite[850],
  surfaceHover: 'rgba(255, 255, 255, 0.04)',
  surfacePressed: 'rgba(255, 255, 255, 0.08)',

  border: 'rgba(255, 255, 255, 0.08)',
  // Heavier than it looks like it wants to be. `borderStrong` is the edge of a
  // secondary button and the unfilled half of the progress track, so SC 1.4.11
  // asks 3:1 of it against the ground — a boundary you cannot see is not a
  // boundary. `border` stays a hairline; it is decorative separation.
  borderStrong: 'rgba(255, 255, 255, 0.36)',

  textPrimary: graphite[50],
  textSecondary: graphite[300],
  textTertiary: graphite[350],
  textOnAccent: graphite[1000],

  accent: amber[500],
  accentText: amber[400],
  accentMuted: 'rgba(222, 154, 63, 0.14)',

  danger: status.dangerDark,
  success: status.successDark,
  warning: status.warningDark,

  scrim: 'rgba(0, 0, 0, 0.6)',
  skeleton: graphite[850],
};

export const light: ColorScheme = {
  bg: graphite[0],
  surface: graphite[50],
  surfaceRaised: graphite[0],
  surfaceOverlay: graphite[0],
  surfaceHover: 'rgba(0, 0, 0, 0.04)',
  surfacePressed: 'rgba(0, 0, 0, 0.07)',

  border: 'rgba(0, 0, 0, 0.09)',
  borderStrong: 'rgba(0, 0, 0, 0.44)',

  textPrimary: graphite[900],
  textSecondary: graphite[500],
  textTertiary: graphite[450],
  // Dark, as in the dark theme — white on amber only reached 3.44:1, a fail on
  // the most-pressed control in the product. Amber is a light hue; a dark label
  // is what it wants, and it now reads the same way in both themes.
  textOnAccent: graphite[1000],

  accent: amber[600],
  accentText: amber[700],
  accentMuted: 'rgba(190, 124, 40, 0.12)',

  danger: status.dangerLight,
  success: status.successLight,
  warning: status.warningLight,

  scrim: 'rgba(0, 0, 0, 0.35)',
  skeleton: graphite[100],
};

export const colorSchemes = { dark, light } as const;
export type ThemeName = keyof typeof colorSchemes;
