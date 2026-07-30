/**
 * Prop bundles for the gestures that repeat all over the app.
 *
 * Spread onto any `motion` element: `<motion.button {...press} />`. Having them
 * as objects rather than a wrapper component means an existing element picks up
 * the interaction without changing its markup, its classes or its ref — which
 * matters when the thing being animated is also a popover trigger, a drag
 * handle or a form submit.
 *
 * The scale is inversely proportional to the target's size. A 32px icon button
 * needs to move ~8% for the press to register at all; a full-width primary
 * button only needs ~2%, and more would look like it was collapsing.
 */

import { SPRING } from "./config";

/** Icon buttons and other small square targets. */
export const press = {
  whileHover: { scale: 1.06 },
  whileTap: { scale: 0.92 },
  transition: SPRING.snappy,
} as const;

/** Text buttons, pills, list rows — anything wider than it is tall. */
export const pressSubtle = {
  whileHover: { scale: 1.015 },
  whileTap: { scale: 0.975 },
  transition: SPRING.snappy,
} as const;

/**
 * The transport's primary control.
 *
 * No hover growth: it is already the largest, brightest thing in the player and
 * enlarging it further on hover makes the bar jitter as the pointer crosses.
 * The press alone carries it.
 */
export const pressPrimary = {
  whileTap: { scale: 0.9 },
  transition: SPRING.snappy,
} as const;

/** Cards that lift slightly toward the pointer. */
export const liftCard = {
  whileHover: { y: -2 },
  whileTap: { y: 0, scale: 0.995 },
  transition: SPRING.pop,
} as const;
