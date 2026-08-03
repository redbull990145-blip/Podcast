"use client";

import { useScroll, useTransform } from "motion/react";

/**
 * 0 while the page is at rest, 1 once content has travelled under a floating bar.
 *
 * Returns a motion value rather than React state, which is the entire point of
 * doing it this way. Scroll fires far more often than a frame, and putting the
 * offset in state would re-render the whole bar — its nav pills, the queue
 * badge's external-store subscription, the search field and the profile button
 * — on every one of those events, for a shadow. The motion value writes the
 * opacity straight to the node and React never hears about the scroll at all.
 *
 * 24px is roughly one line of body text: far enough that something has
 * demonstrably moved, close enough that the lift has already happened by the
 * time anyone looks up from the first scroll gesture.
 *
 * Shared by the desktop top bar and the phone's tab bar. Both float over the
 * page, so both have the same problem — at the top of an unscrolled page there
 * is nothing behind the bar, and a shadow landing on empty background reads as
 * a seam ruled across the screen rather than as a floating slab.
 */
export function useBarLift() {
  const { scrollY } = useScroll();
  return useTransform(scrollY, [0, 24], [0, 1]);
}
