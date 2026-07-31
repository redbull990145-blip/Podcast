/**
 * The app's motion vocabulary.
 *
 * Everything that animates pulls its timing from here, so the whole app moves
 * with one accent instead of each component inventing its own. Two rules
 * decided the values below.
 *
 * First, springs rather than durations for anything that *moves*. A duration
 * says "take 300ms whatever happens", which means a 4px nudge and a 400px slide
 * take the same time — the small one crawls and the large one snaps. A spring is
 * defined by its physics, so both settle at a speed that looks right for the
 * distance, and an interruption mid-flight carries the existing velocity instead
 * of restarting. That continuity is most of what "premium" actually is.
 *
 * Second, tweens for anything that only *fades or recolours*. Opacity has no
 * momentum in the real world, so a spring on it reads as a wobble.
 *
 * The cubic curves mirror --ease-out / --ease-in-out in globals.css, so the
 * remaining CSS transitions and these JS animations stay indistinguishable.
 */

import type { Transition } from "motion/react";

/** Matches --ease-out: quick to leave, slow to settle. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
/** Matches --ease-in-out. */
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

export const DURATION = {
  fast: 0.14,
  normal: 0.22,
  slow: 0.38,
} as const;

/**
 * Springs, ordered from tightest to loosest.
 *
 * `damping` is set just below critical in each case: enough give to feel
 * physical, not enough to visibly bounce. Overshoot is the difference between
 * "alive" and "toy-like", and the line is a lot closer to zero than it looks.
 */
export const SPRING = {
  /** Presses, toggles, icon swaps. Settles in ~120ms. */
  snappy: { type: "spring", stiffness: 620, damping: 34, mass: 0.6 } satisfies Transition,

  /** Popovers, menus, badges — small elements arriving on screen. */
  pop: { type: "spring", stiffness: 420, damping: 32, mass: 0.7 } satisfies Transition,

  /** Sheets, dialogs, Now Playing. Long travel, so more mass and more damping. */
  sheet: { type: "spring", stiffness: 280, damping: 32, mass: 0.9 } satisfies Transition,

  /**
   * The transcript's travel between lines.
   *
   * Measured off Spotify's lyrics view frame by frame rather than guessed at.
   * Tracking one line across three transitions in a 60fps capture gives a
   * natural frequency of about 12.6 rad/s and a damping ratio just under one:
   * half the distance covered by 125ms, 95% by 310ms, and an overshoot of a
   * single device pixel before it settles.
   *
   * That last detail is the whole character of it. Fully critically damped
   * reads as a slide; a hair under reads as weight arriving and stopping, which
   * is what people describe as the bounce. It stays a hair, because the eye is
   * mid-sentence on these words — anything that visibly rebounds makes them
   * unreadable for the length of the rebound.
   */
  transcript: { type: "spring", stiffness: 150, damping: 20, mass: 0.9 } satisfies Transition,

  /*
   * There is deliberately no spring for caption emphasis. Dimming, blurring and
   * shrinking the neighbouring lines is a CSS transition on `.caption-line` in
   * globals.css instead: roughly seventeen rows are mounted at once, and
   * springing three properties on each of them from JavaScript cost about a
   * tenth of the frames during a line change. Nothing there moves in a way a
   * spring describes, so nothing there is worth the main thread.
   */
} as const;

export const TWEEN = {
  fast: { duration: DURATION.fast, ease: EASE_OUT } satisfies Transition,
  normal: { duration: DURATION.normal, ease: EASE_OUT } satisfies Transition,
  slow: { duration: DURATION.slow, ease: EASE_OUT } satisfies Transition,
} as const;
