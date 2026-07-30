/**
 * Reusable animation variants.
 *
 * Variants are named states rather than inline objects so that a component
 * says *what* it is doing ("this is a popover") instead of restating the
 * numbers. Changing how every popover in the app enters then means editing one
 * object here, and two popovers can never drift apart by accident.
 *
 * Only `transform`, `opacity` and small `filter` blurs appear below. Those are
 * the properties a compositor can animate without asking the main thread to
 * re-layout or repaint, which is what keeps this at 60fps while audio decoding,
 * position syncing and React are all competing for the same thread.
 */

import type { Variants } from "motion/react";
import { SPRING, TWEEN } from "./config";

/** Content arriving in place: a fade with just enough lift to imply direction. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { ...SPRING.pop, opacity: TWEEN.normal } },
  exit: { opacity: 0, y: -4, transition: TWEEN.fast },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: TWEEN.normal },
  exit: { opacity: 0, transition: TWEEN.fast },
};

/**
 * Menus and popovers.
 *
 * The scale starts at 0.96 rather than 0, and the origin is set by the caller
 * via `transform-origin`. Growing from nothing is a stock "web animation" tell;
 * native menus expand a few percent from the control that opened them, which
 * reads as the control unfolding rather than a new object appearing.
 */
export const popover: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: SPRING.pop },
  exit: { opacity: 0, scale: 0.97, y: 2, transition: TWEEN.fast },
};

/** Full-screen sheets — Now Playing. Rises from the bottom like a native sheet. */
export const sheet: Variants = {
  hidden: { y: "100%" },
  visible: { y: 0, transition: SPRING.sheet },
  exit: { y: "100%", transition: { ...TWEEN.slow, ease: [0.4, 0, 1, 1] } },
};

/** Centred modal dialogs. */
export const dialog: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 12 },
  visible: { opacity: 1, scale: 1, y: 0, transition: SPRING.sheet },
  exit: { opacity: 0, scale: 0.97, y: 6, transition: TWEEN.fast },
};

export const backdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: TWEEN.normal },
  exit: { opacity: 0, transition: TWEEN.normal },
};

/**
 * Lists that reveal their rows in sequence.
 *
 * `staggerChildren` is small on purpose. A long cascade looks impressive once
 * and then costs the user real time on every subsequent visit; 25ms per row
 * with a cap of a few rows' worth of delay is enough to read as "these arrived
 * together" without anyone waiting for it.
 */
export const listContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.025, delayChildren: 0.02 } },
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: SPRING.pop },
};

/**
 * Route transitions.
 *
 * Very short and very small. A page change already costs a server round trip,
 * so the animation has to be over before the content it is covering would have
 * been readable — otherwise it is not polish, it is latency someone can feel.
 */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } },
};
