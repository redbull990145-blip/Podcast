/**
 * The motion system.
 *
 * One source of durations, easings, springs and gesture thresholds for both
 * platforms. Components import tokens from here and never write a literal
 * animation value — that is the whole point. When every component invents its
 * own 0.3s ease-out, the product has no sense of weight; when they all pull
 * from five presets, it does.
 *
 * Platform bindings (Motion for React, Reanimated) live in their own apps.
 * This package stays free of both so it can be unit tested and so neither
 * platform's API leaks into the other's.
 */

export { spring, springRest } from './springs.ts';
export type { Spring, SpringToken } from './springs.ts';

export { cssEasing, duration, easing } from './timing.ts';
export type { DurationToken, Easing, EasingToken } from './timing.ts';

export { gesture, rubberBand, settleVelocity, shouldCommit } from './gestures.ts';

export {
  canTravel,
  motionSpec,
  pressScale,
  reduceDuration,
  reducedPolicy,
  reducedTween,
} from './reduced.ts';
export type { MotionSpec, ReducedTween } from './reduced.ts';
