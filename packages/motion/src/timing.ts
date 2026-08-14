/**
 * Tweens.
 *
 * Springs move things. Tweens fade things.
 *
 * Opacity is animated with a tween and never a spring: a spring overshoots
 * past 1, the compositor clamps it, and the clamp reads as a flicker at the
 * end of every fade. That single rule removes a whole class of "why does this
 * look cheap" bugs.
 */

export type Easing = readonly [number, number, number, number];

export const easing = {
  /** Default. Fast out of the gate, long gentle settle. */
  standard: [0.2, 0, 0, 1],
  /** Leaving the screen — no need to decelerate into somewhere it isn't going. */
  exit: [0.4, 0, 1, 1],
  /** Entering from nothing. */
  enter: [0, 0, 0.2, 1],
  /** Symmetric, for things that reverse (a crossfade both ways). */
  inOut: [0.45, 0, 0.55, 1],
} as const satisfies Record<string, Easing>;

export type EasingToken = keyof typeof easing;

/**
 * Durations, in ms.
 *
 * Ceiling is 320ms on purpose. Anything slower stops reading as feedback and
 * starts reading as a wait, and the brief is explicit that responsiveness
 * beats drama.
 */
export const duration = {
  /** Press states, hover. Perceptually immediate but not a hard cut. */
  instant: 100,
  /** Fades between adjacent states. */
  fast: 160,
  /** The default tween. */
  base: 220,
  /** Largest allowed. Full-screen fades only. */
  slow: 320,
} as const;

export type DurationToken = keyof typeof duration;

/** CSS-formatted easing, for the rare place that needs a raw string. */
export function cssEasing(token: EasingToken): string {
  const [a, b, c, d] = easing[token];
  return `cubic-bezier(${a}, ${b}, ${c}, ${d})`;
}
