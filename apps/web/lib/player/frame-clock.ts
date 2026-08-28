'use client';

import { useEffect, useRef } from 'react';

/**
 * One animation frame loop for everything that follows the playhead.
 *
 * Six components used to run a `requestAnimationFrame` loop of their own: the
 * scrubber, the caption sweep, the transcript panel, the up-next countdown and
 * both of the home screen's progress bars. Each was individually careful —
 * writing motion values rather than state, rounding before comparing — and
 * collectively they were the most expensive thing on the page, for three
 * reasons that only show up when you count them together.
 *
 * **The playhead was read once per loop rather than once per frame.**
 * `readPosition` is memoised on a timestamp, and every loop called it with a
 * *different* `performance.now()`, so the memo never hit. Five loops meant five
 * reads of `HTMLMediaElement.currentTime` and five advances of the smoothing
 * model per frame — the exact defect the memo was written to prevent, quietly
 * not working because nothing supplied a shared instant to key it on. Driving
 * the fan-out from one rAF callback gives every consumer the same timestamp,
 * which is what makes the memo do its job.
 *
 * **Reads and writes were interleaved.** The loops ran in whatever order they
 * mounted, so a component that measured the DOM could land between two that
 * wrote to it. One callback that reads the clock up front and then lets
 * subscribers write is a read phase followed by a write phase by construction.
 *
 * **The cost scaled with the refresh rate.** All of the above ran per frame, so
 * a 144Hz display paid 2.4x what a 60Hz one did for the same second of audio —
 * the faster the panel, the further behind it fell. At 140Hz the whole frame
 * budget is 7.1ms, and this was spending it on work that had already been done.
 *
 * The loop starts with its first subscriber and stops with its last, so a
 * paused player costs nothing at all.
 */

type Subscriber = (timestampMs: number) => void;

const subscribers = new Set<Subscriber>();

let rafId: number | null = null;

/**
 * The instant the current frame is being drawn for, or null between frames.
 *
 * `readPosition` keys its memo on this, which is what collapses N consumers
 * into one clock read. Null outside the callback on purpose: a read that
 * happens outside a frame — a one-shot after a seek while paused — must not be
 * answered from a cache belonging to whenever the loop last ran.
 */
let frameStampMs: number | null = null;

export function currentFrameStamp(): number | null {
  return frameStampMs;
}

function tick(timestampMs: number): void {
  // Queued before the fan-out, not after, so a subscriber that throws cannot
  // stop the clock for everything else on the page.
  rafId = requestAnimationFrame(tick);

  frameStampMs = timestampMs;
  try {
    // Iterated directly rather than through a copy: this runs at the refresh
    // rate, and a `Set` tolerates deletion during iteration — an unsubscribe
    // from inside a callback simply is not visited.
    for (const subscriber of subscribers) subscriber(timestampMs);
  } finally {
    frameStampMs = null;
  }
}

/**
 * Join the frame loop from outside React.
 *
 * For the engine, which is a module singleton rather than a component and so
 * has no hook to hang a subscription on. Returns its own unsubscribe.
 */
export function subscribeToFrames(subscriber: Subscriber): () => void {
  return subscribe(subscriber);
}

function subscribe(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  if (rafId === null) rafId = requestAnimationFrame(tick);

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
}

/**
 * Run `onFrame` every animation frame while `active`.
 *
 * The callback is held in a ref and read through it, so a component may pass a
 * fresh closure on every render — the overwhelmingly common case, since these
 * callbacks close over props — without tearing the subscription down and
 * rebuilding it. That matters more than it sounds: resubscribing on every
 * render of a component that renders often would churn the shared `Set` at the
 * refresh rate, and `active` flipping is then the *only* thing that starts or
 * stops the loop.
 *
 * **On assigning a ref during render.** React's rule is not to read or write
 * `ref.current` while rendering, and the reason is that a concurrent render
 * may be discarded — so a value written during one can describe a tree that
 * was never committed. It is safe here, narrowly and for a specific reason:
 * this ref is never *read* during render. It is read only from the rAF
 * callback, which cannot run during one, and any discarded render's closure is
 * overwritten by the next committed one before a frame can observe it. The
 * blessed alternative is `useLayoutEffect`, which is declined because it warns
 * on every server render of components that all render on the server, to buy
 * back a guarantee this call site does not need.
 */
export function useFrameLoop(active: boolean, onFrame: Subscriber): void {
  const ref = useRef(onFrame);
  ref.current = onFrame;

  useEffect(() => {
    if (!active) return;
    return subscribe((timestampMs) => ref.current(timestampMs));
  }, [active]);
}
