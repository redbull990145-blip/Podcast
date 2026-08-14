/**
 * Reduced motion.
 *
 * The rule the brief sets, and the right one: reduce movement, keep meaning.
 * Someone with vestibular sensitivity still needs to know the player opened,
 * that the like registered, that the download finished. So we strip travel,
 * parallax and springiness — and keep every state change visible, just as a
 * short opacity/scale change instead of a journey across the screen.
 *
 * What this is not: `animation: none`. Killing all feedback makes the app
 * feel broken rather than calm.
 */

import { spring, type Spring, type SpringToken } from './springs.ts';
import { duration, easing, type Easing } from './timing.ts';

export type ReducedTween = {
  duration: number;
  easing: Easing;
};

/** The single tween that stands in for any spring under reduced motion. */
export const reducedTween: ReducedTween = {
  duration: 120,
  easing: easing.standard,
};

/**
 * How a given interaction degrades. Components read this instead of writing
 * their own `if (prefersReducedMotion)` branch, so the policy stays in one
 * place and can't drift.
 */
export const reducedPolicy = {
  /** Travel is removed; the thing changes in place. */
  translate: false,
  /** Scale is kept but shallower — it still reads as "this responded". */
  scale: true,
  maxScaleDelta: 0.04,
  /** Parallax and ambient drift are pure decoration. Gone. */
  parallax: false,
  /** Transcript auto-scroll becomes an instant jump, not a glide. */
  smoothScroll: false,
  /** Opacity always stays: it is how state change survives everything else. */
  opacity: true,
} as const;

/**
 * Cap a duration under reduced motion. Long fades are their own kind of
 * discomfort, so nothing is allowed to outlast the base tween.
 */
export function reduceDuration(ms: number): number {
  return Math.min(ms, duration.base);
}

/**
 * What a piece of motion should actually do, given the preference.
 *
 * Returned as a description rather than a platform transition because Motion
 * for React and Reanimated take different shapes for the same physics. The
 * *decision* is shared and tested once; only the final translation is per
 * platform. Without this the policy above is decoration — each component ends
 * up writing its own `if (reduced)` branch and they disagree, which is exactly
 * what happened to the press scale before this existed.
 */
export type MotionSpec =
  | ({ kind: 'spring' } & Spring)
  | ({ kind: 'tween' } & ReducedTween);

export function motionSpec(token: SpringToken, reduced: boolean): MotionSpec {
  if (reduced) return { kind: 'tween', ...reducedTween };
  return { kind: 'spring', ...spring[token] };
}

/**
 * Whether a thing is allowed to travel across the screen.
 *
 * The one call every layout animation has to make. When this is false the
 * element still changes state — it just arrives rather than journeys.
 */
export function canTravel(reduced: boolean): boolean {
  return !reduced || reducedPolicy.translate;
}

/**
 * Press feedback, shallower rather than absent.
 *
 * Reduced motion keeps scale (`reducedPolicy.scale`) because on a touch screen
 * the press-squash is the only thing that answers "did that land?" — there is
 * no cursor and no hover state to answer first. Removing it entirely makes
 * every control feel dead, which is a worse outcome than a 4% squash.
 *
 * `Math.max` rather than a straight swap: a control whose normal press is
 * already gentler than the cap keeps its own value instead of being amplified
 * to meet it.
 */
export function pressScale(scale: number, reduced: boolean): number {
  if (!reduced || !reducedPolicy.scale) return scale;
  return Math.max(scale, 1 - reducedPolicy.maxScaleDelta);
}
