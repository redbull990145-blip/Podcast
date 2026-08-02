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
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    // Spring the movement, tween the fade — see the note on `fadeUp` above.
    transition: { ...SPRING.pop, opacity: TWEEN.normal },
  },
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
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { ...SPRING.sheet, opacity: TWEEN.normal },
  },
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
  /*
   * The whole list leaves together rather than un-staggering row by row. A
   * reversed cascade on the way out makes the user wait through an animation
   * for something they have already decided to leave, and it is the one moment
   * where the stagger stops reading as "these arrived together".
   */
  exit: { opacity: 0, transition: TWEEN.fast },
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { ...SPRING.pop, opacity: TWEEN.normal } },
};

/**
 * Home's top-level cascade.
 *
 * 80ms between blocks, against the 25ms `listContainer` uses for rows, because
 * these are different things being staggered. `listContainer` sequences a dozen
 * near-identical rows, where the delay is only there to stop them arriving as
 * one flat sheet — any more and the last row is late. This sequences four large
 * blocks that each read as their own object, so the gap is doing real work:
 * it is what makes the hero land before the statistics rather than with them.
 *
 * Four blocks at 80ms is a 240ms cascade on top of a ~175ms block animation:
 * the last one has settled by about 460ms. That is the ceiling. Past roughly
 * 600ms a cascade stops reading as an entrance and starts reading as the page
 * still loading.
 *
 * ## Why this is a delay and not `staggerChildren`
 *
 * The obvious implementation is a container variant with `staggerChildren`,
 * letting Motion propagate "visible" down the tree and time each child. It is
 * less code and it keeps the timing in one place. It is not what this does, for
 * two reasons that are about this page specifically.
 *
 * Home is an async server component, so the container would be a client
 * component receiving server-rendered children which are themselves client
 * components, and the cascade would depend on one orchestration reaching
 * through every one of those boundaries. When that kind of chain does break it
 * does not degrade — the children never leave `hidden`, so the failure is
 * "the hero is permanently invisible", with no error and nothing in the markup
 * to explain it. An explicit delay can only ever be the wrong number.
 *
 * The second reason is that two of the four blocks are already stagger
 * containers themselves. Nesting orchestration inside orchestration means the
 * inner delays compose with the outer ones, and working out when the last
 * bento tile actually lands requires holding three numbers at once. Here each
 * block is told one start time and owns everything after it.
 */
const CASCADE_STEP = 0.08;
const CASCADE_LEAD = 0.04;

/** Start time for the nth block of Home's entrance, in seconds. */
export function cascade(index: number): number {
  return CASCADE_LEAD + index * CASCADE_STEP;
}

/**
 * One block of that cascade.
 *
 * `y: 15` where `listItem` uses 6 and `fadeUp` uses 8, because travel has to
 * scale with the thing travelling. These blocks are the largest objects on the
 * page — a 719px hero, a 513px bento — and 6px on a 225px-tall card is a
 * quarter of the proportional distance that same 6px covers on a 52px row. It
 * reads as the card twitching rather than arriving.
 *
 * A function variant rather than a static one so the delay arrives through
 * `custom`. The delay has to be repeated inside the `opacity` override: a
 * `delay` sitting beside per-property transitions applies only to the
 * properties that did not override it, so without this the fade would start on
 * time and the lift 300ms later — which looks like two separate animations,
 * because it is.
 */
export const dashboardBlock: Variants = {
  hidden: { opacity: 0, y: 15 },
  visible: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      ...SPRING.pop,
      delay,
      opacity: { ...TWEEN.normal, delay },
    },
  }),
};

/**
 * A bento tile: enters with the cascade, lifts under the pointer.
 *
 * The hover offset is -4, twice `liftCard`'s -2, and that is not an
 * inconsistency. `liftCard` is shared by the covers on Discover and Library,
 * where a lift is competing with the artwork for attention; these are quiet
 * panels of text where the same 2px is invisible.
 *
 * Each tile takes its own delay rather than being staggered by its container.
 * The container version was written first and measured: with `whileHover` and
 * `whileTap` given as variant *labels* — which they must be here, so the
 * shadow layer inside can follow the same state — the tiles stopped picking up
 * the inherited "visible" and rendered with no inline style at all, meaning no
 * entrance ran. Named gesture states and inherited enter states do not compose
 * on the same element, so the enter state is stated outright.
 */
export const bentoTile: Variants = {
  hidden: { opacity: 0, y: 15 },
  visible: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      ...SPRING.pop,
      delay,
      opacity: { ...TWEEN.normal, delay },
    },
  }),
  hover: { y: -4, transition: SPRING.pop },
  press: { y: -1, scale: 0.995, transition: SPRING.snappy },
};

/** 25ms between tiles: 75ms across the four, one arrival with texture. */
export function bentoTileDelay(base: number, index: number): number {
  return base + index * 0.025;
}

/**
 * `listContainer` with its start time supplied through `custom`.
 *
 * This exists because orchestration cannot be passed through the `transition`
 * prop. That was the first attempt — `transition={{ staggerChildren: 0.025,
 * delayChildren: delay }}` on the container — and it silently did nothing:
 * Motion reads `staggerChildren`, `delayChildren` and `when` from the
 * *resolved variant's* transition, and treats the `transition` prop as the
 * default for the element's own animating values only. The row kept
 * `listContainer`'s built-in 20ms and arrived at 56ms into a slot that starts
 * at 200 — ahead of the hero it is supposed to follow.
 *
 * The failure is worth naming because it has no symptom at the call site. The
 * prop is accepted, nothing warns, and the only evidence is that the cascade
 * comes out in the wrong order.
 */
export const cascadedList: Variants = {
  hidden: {},
  visible: (delay: number = 0) => ({
    transition: { staggerChildren: 0.025, delayChildren: delay },
  }),
  exit: { opacity: 0, transition: TWEEN.fast },
};

/**
 * The deeper shadow a hovered tile casts, as a layer rather than a value.
 *
 * `whileHover={{ boxShadow: … }}` is the obvious way to write this and it is
 * the expensive one: a shadow is a paint property, so interpolating it
 * re-rasterises the blur on every frame of every hover, on four tiles that sit
 * next to a 20px backdrop-filter. Cross-fading a second pre-rendered shadow is
 * a compositor operation and the blur is rasterised once.
 *
 * The same trick, for the same reason, as `.glass-lift` under the top bar.
 */
export const bentoTileShadow: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 0 },
  hover: { opacity: 1, transition: TWEEN.normal },
  press: { opacity: 0.6, transition: TWEEN.fast },
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
