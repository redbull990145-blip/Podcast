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

export const spring = {
  /** Ambient, non-urgent. Background wash, ambient artwork drift. */
  gentle: { stiffness: 120, damping: 20, mass: 1 },

  /** The default. Anything moving without a strong opinion uses this. */
  standard: { stiffness: 260, damping: 30, mass: 1 },

  /** Direct feedback on a control the finger is on. */
  responsive: { stiffness: 400, damping: 34, mass: 0.9 },

  /** Small, immediate, near-instant settle. Toggles, checkmarks. */
  snappy: { stiffness: 560, damping: 40, mass: 0.8 },

  /** Large travel that should feel weighty: player expansion, sheets. */
  expressive: { stiffness: 300, damping: 28, mass: 1.05 },
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
