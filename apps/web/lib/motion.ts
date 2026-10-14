'use client';

import {
  canTravel,
  motionSpec,
  pressScale,
  type MotionSpec,
  type SpringToken,
} from '@cue/motion';
import type { Transition } from 'motion/react';
import { useMemo, useSyncExternalStore } from 'react';

/**
 * The web's binding to the shared motion policy.
 *
 * This exists because the stylesheet cannot do the job. Motion for React
 * writes `transform` as an inline style, and an inline style outranks a class
 * rule — so `@media (prefers-reduced-motion)` in `globals.css` has no effect
 * whatsoever on the player's expansion, the travelling artwork, or a
 * `whileTap` squash. Every JS-driven animation has to ask the preference
 * itself, and it asks here so the answer is the same one Android gives.
 *
 * The decisions live in `@cue/motion`; this file only translates them into
 * Motion's shapes.
 */

// The installed Motion hook snapshots this setting only on mount. Subscribe
// directly so an OS preference change also updates controls already on screen.
function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

/**
 * Convert a shared spec into a Motion transition.
 *
 * Exported for tests: the token scale is in milliseconds and Motion's `tween`
 * takes seconds, and getting that wrong produces a two-minute fade rather than
 * an error.
 */
export function toTransition(spec: MotionSpec): Transition {
  if (spec.kind === 'tween') {
    return { duration: spec.duration / 1000, ease: [...spec.easing] };
  }

  const { kind: _kind, ...physics } = spec;
  return { type: 'spring', ...physics };
}

/**
 * The transition for a named spring, degraded if the user asked for less.
 *
 * Memoised on the two things that can actually change it. A fresh object every
 * render would be a new dependency for any effect that starts an animation
 * with it — which restarts the animation on every render, so the player would
 * never finish opening.
 */
export function useTransition(token: SpringToken): Transition {
  const reduced = usePrefersReducedMotion();
  return useMemo(() => toTransition(motionSpec(token, reduced)), [token, reduced]);
}

/**
 * Whether this component may move something across the screen.
 *
 * Callers branch on it rather than scaling the distance down: half a slide is
 * still a slide, and the policy is that travel is replaced, not shortened.
 */
export function useCanTravel(): boolean {
  return canTravel(usePrefersReducedMotion());
}

/** A press-squash depth that survives reduced motion instead of vanishing. */
export function usePressScale(scale: number): number {
  return pressScale(scale, usePrefersReducedMotion());
}
