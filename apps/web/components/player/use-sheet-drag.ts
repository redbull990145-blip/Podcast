'use client';

import { gesture, settleVelocity, shouldCommit } from '@cue/motion';
import { animate, type MotionValue, type Transition } from 'motion/react';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Dragging the player open and shut.
 *
 * **The gesture writes the expansion value itself.** That sounds like a detail
 * and it is the whole difference between a sheet that feels attached to your
 * finger and one that does not.
 *
 * What it replaced: the sheet was dragged with Motion's `drag`, which moves an
 * element by writing its `y`. But `y` was already derived from `expansion`, and
 * the moment a drag began the component also set `expanded`, which started a
 * spring writing the same `y` from the other end. So the finger and the spring
 * were arguing over one property for the length of every gesture. The sheet did
 * open, which is why it looked like it worked — but it was opening *on its own*
 * with the drag offset added on top, and the drag never actually decided
 * anything. That is the weightlessness: nothing you touch is moving because you
 * touched it.
 *
 * Here the pointer writes `expansion` directly, one pixel of finger to one pixel
 * of sheet, and the spring only takes over once you let go — starting from the
 * velocity the gesture ended on, so releasing mid-throw continues the movement
 * rather than restarting it.
 */
export type SheetDrag = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
};

type Options = {
  /** 0 = collapsed, 1 = expanded. Written directly while dragging. */
  expansion: MotionValue<number>;
  /** Screen distance the sheet travels between the two states, in px. */
  travelPx: number;
  /** The settle spring, already degraded for reduced motion if need be. */
  settle: Transition;
  /**
   * Told which state the sheet is heading for, so React can catch up. Called
   * once per gesture, on release — never during, because the drag does not
   * need React and re-rendering the player sixty times a second would undo the
   * point of putting the expansion in a motion value in the first place.
   */
  onCommit: (expanded: boolean) => void;
  /** False under reduced motion, where the sheet does not travel at all. */
  enabled: boolean;
};

export function useSheetDrag({
  expansion,
  travelPx,
  settle,
  onCommit,
  enabled,
}: Options): SheetDrag {
  const drag = useRef<{
    pointerId: number;
    startY: number;
    startExpansion: number;
    /** Cleared once the pointer has moved far enough to be a drag and not a tap. */
    pending: boolean;
    lastY: number;
    lastTime: number;
    velocity: number;
  } | null>(null);

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (!enabled || travelPx <= 0) return;
    // Mouse wheel clicks and right buttons are not drags.
    if (event.button !== 0) return;

    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startExpansion: expansion.get(),
      pending: true,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;

    const dy = event.clientY - current.startY;

    /**
     * A tap is not a drag until it has travelled.
     *
     * Without this every button under the drag surface would be unusable: the
     * pointer capture below cancels the click, so pressing play would move the
     * sheet by a pixel and swallow the press.
     */
    if (current.pending) {
      if (Math.abs(dy) < gesture.activationDistance) return;
      current.pending = false;
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    // Velocity from the last sample rather than from the start of the gesture:
    // what matters on release is how fast the finger was moving *then*, not its
    // average over a drag that may have paused halfway.
    const elapsed = event.timeStamp - current.lastTime;
    if (elapsed > 0) {
      current.velocity = ((event.clientY - current.lastY) / elapsed) * 1000;
      current.lastY = event.clientY;
      current.lastTime = event.timeStamp;
    }

    // Up is positive: the sheet opens upward, and expansion grows as it does.
    const next = current.startExpansion - dy / travelPx;
    expansion.set(Math.max(0, Math.min(1, next)));
  }

  function finish(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;

    if (current.pending) return; // Never became a drag. Leave the click alone.

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    /**
     * Commit relative to where the gesture *started*.
     *
     * Measuring against a fixed direction gets one of the two cases wrong: a
     * 10% nudge downward from the open state is not "less than 35% of the way
     * to open", it is a nudge that should spring back. So the question asked is
     * always "did this go far enough to reach the other state", whichever state
     * that happens to be.
     */
    const startedExpanded = current.startExpansion > 0.5;
    const towardOther = startedExpanded
      ? event.clientY - current.startY
      : current.startY - event.clientY;
    const velocityToward = startedExpanded ? current.velocity : -current.velocity;

    const flips = shouldCommit(towardOther, velocityToward, travelPx);
    const expanded = flips ? !startedExpanded : startedExpanded;

    animate(expansion, expanded ? 1 : 0, {
      ...settle,
      // Signed for the value, not the screen: the finger moving down is the
      // expansion falling, so the sign flips on the way through.
      velocity: -settleVelocity(current.velocity, travelPx),
    });

    onCommit(expanded);
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
  };
}
