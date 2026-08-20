/**
 * The spring presets, rewritten as something CSS can run.
 *
 * `spring()` in `springs.ts` is consumed by Motion and by Reanimated, both of
 * which integrate the physics on every frame from JavaScript. That is the right
 * answer for anything a gesture can interrupt — a drag hands the spring its
 * velocity and the spring carries it — and it is the wrong answer for the
 * dozens of small state changes that are a CSS `transition` and nothing more.
 *
 * Those had to fall back to `cubic-bezier`, and a cubic bezier cannot express a
 * spring: four control points describe one smooth arc, so the overshoot-and-
 * settle that makes motion read as an *object* is exactly the shape it cannot
 * draw. The result is a product where the things JavaScript animates feel
 * sprung and the things CSS animates feel drawn, which is precisely the
 * incoherence the token system exists to prevent.
 *
 * `linear()` closes the gap. It takes an arbitrary list of samples and
 * interpolates between them, so the real solution to the damped oscillator can
 * simply be *tabulated* — same physics, same numbers, evaluated by the
 * compositor off the main thread. One vocabulary of weight across the app.
 */

import { spring, type Spring, type SpringToken } from './springs.ts';

/**
 * The two numbers that actually describe a spring's feel.
 *
 * See the note in `springs.ts`: stiffness and mass only matter through their
 * ratio, and every formula below is written in terms of these rather than the
 * raw preset so the relationship stays visible.
 */
function describe({ stiffness, damping, mass }: Spring) {
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  return { omega, zeta };
}

/**
 * Position of a unit step response at time `t`, in seconds.
 *
 * Three regimes, because the closed-form solution genuinely is three different
 * functions and the underdamped one divides by `ω_d`, which is zero at ζ = 1.
 * Every preset we ship is underdamped; the other two branches exist so this is
 * a correct spring solver rather than one that happens to suit today's tokens.
 */
function displacement(t: number, omega: number, zeta: number): number {
  if (zeta < 1) {
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * t);
    return 1 - decay * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
  }

  if (zeta === 1) {
    const decay = Math.exp(-omega * t);
    return 1 - decay * (1 + omega * t);
  }

  const rate = omega * Math.sqrt(zeta * zeta - 1);
  const fast = -zeta * omega - rate;
  const slow = -zeta * omega + rate;
  return 1 - (fast * Math.exp(slow * t) - slow * Math.exp(fast * t)) / (fast - slow);
}

/**
 * When the motion is visually over, in ms.
 *
 * Stepped rather than solved. The analytic settle time of an underdamped spring
 * is the envelope crossing the threshold, which overestimates: the envelope is
 * a bound on the oscillation, and the oscillation crosses back inside it
 * between peaks. Walking forward and asking "has it stayed inside for a whole
 * half-cycle" gives the time a person would call it finished.
 *
 * The cap is not defensive. A duration is the one thing `linear()` cannot carry
 * — it describes the shape of the curve and the stylesheet supplies the clock —
 * so an absurd answer here becomes an absurd transition rather than an error.
 */
const SETTLE = 0.002;
const MAX_MS = 2000;

function settleMs(omega: number, zeta: number): number {
  const step = 1 / 240;
  let restingFor = 0;

  for (let t = step; t <= MAX_MS / 1000; t += step) {
    if (Math.abs(1 - displacement(t, omega, zeta)) < SETTLE) {
      restingFor += step;
      // A tenth of a second inside the threshold. Long enough that a spring
      // crossing its target on the way to an overshoot is not mistaken for one
      // that has arrived.
      if (restingFor >= 0.1) return Math.round((t - restingFor) * 1000);
    } else {
      restingFor = 0;
    }
  }

  return MAX_MS;
}

/**
 * How many samples the curve is tabulated at.
 *
 * `linear()` interpolates straight lines between stops, so this is a question
 * about how much of the curvature survives. Sixty across a settle of half a
 * second is a sample every ~8ms — finer than a frame at 120Hz, which is the
 * point at which more stops cannot change anything anybody can see, and each
 * one costs bytes in the stylesheet on every page load.
 */
const SAMPLES = 60;

/**
 * A spring as a CSS `linear()` easing, plus the duration to run it over.
 *
 * The two are returned together because they are one thing. `linear()` is a
 * normalised shape — hand it a different duration and it is a different spring,
 * so a component that takes the easing and picks its own timing has quietly
 * left the system. Emitted as a pair of custom properties for exactly that
 * reason.
 */
export function springEasing(token: SpringToken): { easing: string; durationMs: number } {
  const { omega, zeta } = describe(spring[token]);
  const durationMs = settleMs(omega, zeta);
  const seconds = durationMs / 1000;

  const stops: string[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const t = (i / SAMPLES) * seconds;
    // Pinned at the ends. The sampled value at `t = durationMs` is within
    // `SETTLE` of 1 but not exactly 1, and a transition that lands on 0.9997
    // leaves a permanent sub-pixel offset on anything it moved.
    const value = i === 0 ? 0 : i === SAMPLES ? 1 : displacement(t, omega, zeta);
    stops.push(value.toFixed(4).replace(/\.?0+$/u, ''));
  }

  return { easing: `linear(${stops.join(', ')})`, durationMs };
}
