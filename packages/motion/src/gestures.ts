/**
 * Gesture thresholds.
 *
 * Shared between platforms so that dragging the player down feels the same on
 * a phone and in a browser. The decision rule is deliberately velocity-first:
 * a fast short flick means "dismiss", a slow long drag means "I'm reading
 * where this goes". Distance-only thresholds punish flicks and feel sticky.
 */

export const gesture = {
  /** px/s past which a flick commits regardless of distance travelled. */
  commitVelocity: 500,

  /** Fraction of total travel past which a slow drag commits on release. */
  commitDistanceRatio: 0.35,

  /**
   * Resistance applied when dragging past a boundary. 0 = immovable,
   * 1 = no resistance. 0.55 is firm enough to signal "this is the end" while
   * still tracking the finger, which is what makes an edge feel physical
   * rather than broken.
   */
  rubberBand: 0.55,

  /** px of movement before a pan is recognised, so taps stay taps. */
  activationDistance: 6,

  /**
   * Velocity carried into the settle spring, clamped. Uncapped velocity from a
   * hard flick produces a visible overshoot that looks like a glitch.
   */
  maxSettleVelocity: 2400,
} as const;

/**
 * Apply rubber-band resistance to an overscrolled offset.
 * Pure maths, so both platforms and the tests use exactly this function.
 */
export function rubberBand(overshoot: number, resistance = gesture.rubberBand): number {
  return overshoot * (1 - resistance);
}

/**
 * Decide whether a released drag should commit or spring back.
 *
 * @param offset    distance travelled, same units as `total`
 * @param velocity  units/second at release, signed
 * @param total     full travel distance for the interaction
 */
export function shouldCommit(offset: number, velocity: number, total: number): boolean {
  if (Math.abs(velocity) >= gesture.commitVelocity) {
    // A flick decides by direction, not by how far it happened to get.
    return velocity > 0;
  }
  return total > 0 && offset / total >= gesture.commitDistanceRatio;
}

/**
 * The hand-off from finger to spring.
 *
 * A settle animation that starts from zero velocity is the single most common
 * reason a draggable surface feels weightless: the finger throws the sheet, the
 * finger lifts, and the sheet forgets it was moving and starts again from
 * standstill. Seeding the spring with the velocity the gesture actually ended
 * on is what makes the release read as *letting go of* something rather than
 * *triggering* something.
 *
 * @param pxPerSecond pointer velocity at release, signed, in screen pixels
 * @param travelPx    screen distance the progress value 0→1 corresponds to
 * @returns velocity in units of the progress value per second
 */
export function settleVelocity(pxPerSecond: number, travelPx: number): number {
  if (travelPx <= 0) return 0;

  // Capped before the conversion. An uncapped flick — trackpads report several
  // thousand px/s — produces an overshoot far past the target that reads as the
  // animation glitching rather than as momentum.
  const capped = Math.max(
    -gesture.maxSettleVelocity,
    Math.min(gesture.maxSettleVelocity, pxPerSecond),
  );

  return capped / travelPx;
}
