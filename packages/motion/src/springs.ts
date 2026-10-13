/**
 * Spring presets.
 *
 * Five, deliberately. A larger set stops being a system and becomes a
 * dropdown; components then pick by vibe and the product loses its single
 * sense of weight.
 *
 * The same three numbers drive both platforms — Motion for React takes
 * `{ type: 'spring', stiffness, damping, mass }` and Reanimated's `withSpring`
 * takes `{ stiffness, damping, mass }`. Identical physics, so an interaction
 * genuinely feels the same on web and on Android rather than approximately
 * the same.
 *
 * None of these overshoot much. Apple-like motion is controlled and
 * believable; bounce is a garnish, and a product that bounces everywhere
 * reads as a toy.
 */

export type Spring = {
  stiffness: number;
  damping: number;
  mass: number;
};

/**
 * Why these particular numbers — the "weight" question.
 *
 * A spring has exactly two perceptual dials, and neither of them is a raw
 * stiffness number:
 *
 *   ω₀ = √(k/m)          how *fast* it resolves
 *   ζ  = c / 2√(k·m)     how *tightly* it is controlled
 *
 * Weight is low ω₀ at a ζ just under 1. Something heavy takes longer to get
 * moving, keeps going a touch past its target, and settles once. Something
 * weightless has high ω₀ and ζ near 1: it snaps to its destination and stops
 * dead, which reads as a value being assigned rather than an object moving.
 *
 * Raising stiffness and mass together therefore changes nothing at all — ω₀
 * only moves when their *ratio* does. That is the trap in tuning these by feel.
 */
export const spring = {
  /** Ambient, non-urgent. Background wash, ambient artwork drift. */
  gentle: { stiffness: 120, damping: 20, mass: 1 },

  /** The default. Anything moving without a strong opinion uses this. */
  standard: { stiffness: 300, damping: 26, mass: 1 },

  /**
   * Direct feedback on a control the finger is on. ω₀ 21.1, ζ 0.71.
   *
   * Damping was 34, which is ζ 0.90 — so a released button crept back to full
   * size and stopped exactly there. Correct, and lifeless: a real button
   * rebounds slightly past its resting size when you let go, and that single
   * overshoot is most of what separates a control that feels sprung from one
   * that feels drawn. ω₀ is untouched, so the press still *responds* just as
   * fast; only the release has life in it now.
   */
  responsive: { stiffness: 400, damping: 27, mass: 0.9 },

  /** Small, immediate, near-instant settle. Toggles, checkmarks. */
  snappy: { stiffness: 560, damping: 32, mass: 0.8 },

  /**
   * Large travel: player expansion and sheets. A controlled rebound with a
   * quicker arrival keeps the surface expressive without delaying access.
   * ω₀ 14.1, ζ 0.80.
   */
  expressive: { stiffness: 240, damping: 27, mass: 1.2 },
} as const satisfies Record<string, Spring>;

export type SpringToken = keyof typeof spring;

/**
 * Rest thresholds.
 *
 * Reanimated's defaults (0.01) are tuned for 60Hz. On a 120Hz panel a spring
 * that is still resolving sub-pixel differences wastes frames after the motion
 * is visually finished, so we cut it off at a threshold that is genuinely
 * below one physical pixel and let it settle.
 */
export const springRest = {
  restDisplacementThreshold: 0.05,
  restSpeedThreshold: 0.05,
} as const;
