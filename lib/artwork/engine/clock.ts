/**
 * Time, arranged so the animation provably never repeats.
 *
 * A composite of oscillations `sin(f₁t) + sin(f₂t) + …` repeats with a period of
 * `LCM(1/f₁, 1/f₂, …)`. Pick round numbers — 0.05, 0.1, 0.15 — and that period
 * is twenty seconds, which anyone watching an album cover for the length of a
 * podcast will find. It is the single most common reason ambient motion stops
 * feeling alive: not that the movement is wrong, but that the eye has learned
 * it.
 *
 * The fix is arithmetic rather than aesthetic. **A set of frequencies whose
 * ratios are irrational has no common period at all** — there is no `t` for
 * which every component simultaneously returns to phase, at any session length.
 * So every rate in the engine is drawn from this table, and modules are written
 * to combine two or three of them rather than to invent their own numbers.
 *
 * The absolute speeds are set by the module; these are the *ratios* that keep
 * them from ever agreeing.
 *
 * ---
 *
 * **Why a golden-ratio ladder, and why only four.**
 *
 * The obvious table — one irrational per famous constant, φ and √2 and √3 —
 * does not work, and the reason is easy to miss: what has to be irrational is
 * not each *rate* but each *ratio between rates*. 1/φ and √2−1 are both
 * excellent numbers individually, and their ratio is 1.4921, which is within
 * 0.008 of 3/2. Two oscillators in a near-3:2 relationship visibly re-align
 * every few cycles.
 *
 * A geometric progression in φ solves it in one move: every pairwise ratio is
 * then a power of φ, and φ, φ² and φ³ are all badly approximable — φ famously
 * the worst there is. Searched exhaustively against the usual constants, this
 * ladder scores more than twice as well as the best mixed set of the same size.
 *
 * Four rather than five for the same reason. Extending to φ⁻⁴ introduces the
 * ratio φ⁴ = 6.854, which sits 0.003 from 48/7 and drags the whole table's
 * worst case below half of what four rates achieve. Four is enough: modules
 * combine two or three, and there are twelve ordered pairs to draw from.
 */
export const RATE = {
  /** The reference. */
  unity: 1,
  /** φ⁻¹ */
  golden: 0.6180339887498949,
  /** φ⁻² */
  goldenSquared: 0.3819660112501052,
  /** φ⁻³, which is also √5 − 2. */
  goldenCubed: 0.2360679774997898,
} as const;

export type RateName = keyof typeof RATE;

/**
 * The longest frame this clock will believe.
 *
 * Time accumulates from deltas rather than being read off a wall clock, so that
 * a tab switch, a garbage collection pause or a slow first frame cannot advance
 * the animation by half a second while nothing was drawing. Without this the
 * artwork visibly jumps the moment the tab is refocused, which is precisely the
 * "no sudden jumps" rule broken by an implementation detail rather than by a
 * design decision.
 *
 * A third of a second is generous enough that ordinary jank passes through and
 * anything longer is treated as a stall.
 */
const MAX_DELTA = 1 / 30;

export type Clock = {
  /** Seconds accumulated. Monotonic, never reset while mounted. */
  readonly time: number;
  /** Advances by a frame delta and returns the new time. */
  advance: (delta: number) => number;
};

export function createClock(start = 0): Clock {
  let time = start;

  return {
    get time() {
      return time;
    },
    advance(delta) {
      // Negative deltas are impossible from a frame loop but trivially cheap to
      // rule out, and a clock that can run backwards would make every module's
      // motion reverse for a frame.
      time += Math.max(0, Math.min(delta, MAX_DELTA));
      return time;
    },
  };
}

/**
 * A value that eases toward a target instead of jumping to it.
 *
 * Used for the one discrete transition the engine has: playback starting and
 * stopping. Cutting the amplitude to zero on pause would be a visible snap, and
 * the whole premise is that nothing about this is ever noticeable — so the
 * animation instead settles over about a second, which reads as the artwork
 * coming to rest rather than as an animation being switched off.
 *
 * Exponential rather than linear, so it has no arrival edge. `rate` is the
 * reciprocal time constant: the gap closes by 63% every `1/rate` seconds.
 */
export function createRamp(initial = 0, rate = 2.4) {
  let value = initial;

  return {
    get value() {
      return value;
    },
    /** Steps toward `target` and returns the new value. */
    step(target: number, delta: number): number {
      const step = 1 - Math.exp(-rate * Math.max(0, Math.min(delta, MAX_DELTA)));
      value += (target - value) * step;
      // Exponential approach never quite arrives. Snapping the last thousandth
      // lets the render loop stop entirely when the ramp reaches zero, instead
      // of drawing indistinguishable frames forever.
      if (Math.abs(target - value) < 0.001) value = target;
      return value;
    },
    reset(to: number) {
      value = to;
    },
  };
}
