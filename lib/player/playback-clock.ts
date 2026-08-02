"use client";

/**
 * The one clock every caption reads.
 *
 * ## Why this module exists
 *
 * Before it, the transcript ran on two independent `requestAnimationFrame`
 * loops — one deciding which line was current, one painting the karaoke fill —
 * each sampling `audio.currentTime` for itself and each with its own store
 * subscription as a fallback. They read the same element, so they were nearly
 * always within a frame of each other, and "nearly always" is the problem: at a
 * line boundary the two can land on opposite sides of it, and for that frame
 * the fill is computed against a different segment from the one marked active.
 *
 * Nothing about that is fixable by making the two loops more careful, because
 * the defect is having two of them. One sample per frame, shared by every
 * consumer, makes the two answers agree by construction rather than by
 * coincidence.
 *
 * ## What "the clock" means here
 *
 * Not `audio.currentTime`. That is where the *decoder* is, and between the
 * decoder and the listener's ear sits the output path, which has real and
 * measurable delay. Captions driven by the decoder's position therefore run
 * early by exactly that delay. Where the browser will tell us the figure we
 * subtract it; where it won't, we subtract nothing rather than guess. See
 * `outputLatencySeconds`.
 */

import { getAudio, usePlayer } from "./store";
import { graphOutputLatency } from "./audio-graph";

/**
 * Seconds between `audio.currentTime` and the sound arriving at the output.
 *
 * Only knowable when playback is routed through a Web Audio graph, which is
 * where the API exposes it — `AudioContext.outputLatency` is the buffer the
 * platform holds, and `baseLatency` is what the graph itself adds. For plain
 * element playback no browser exposes an equivalent, so this is zero and the
 * captions carry whatever the platform's own delay is, exactly as before.
 *
 * That asymmetry is not a gap to paper over. Inventing a constant for the plain
 * path would be a hardcoded offset that is wrong on every device that isn't the
 * one it was measured on — worse than the honest zero, because it would be
 * wrong in a direction nobody could see or correct.
 */
export function outputLatencySeconds(): number {
  const latency = graphOutputLatency();
  // A platform that reports something absurd (some report 0, some report
  // undefined, one Android build reported 30) is not usable as a correction.
  // A tenth of a second is already more than any real output path.
  return Number.isFinite(latency) && latency > 0 && latency < 0.1 ? latency : 0;
}

/**
 * The authoritative playback position for caption purposes, in seconds.
 *
 * Falls back to the store when the element has no media. An element with no
 * source reports 0 forever, and pegging every caption to the first line is a
 * worse failure than being a quarter-second stale.
 */
export function captionTime(): number {
  const audio = getAudio();
  if (!audio || !audio.currentSrc) return usePlayer.getState().currentTime;
  return audio.currentTime - outputLatencySeconds();
}

type Listener = (time: number) => void;

const listeners = new Set<Listener>();
let frame: number | null = null;
let unsubscribeStore: (() => void) | null = null;

function emit() {
  if (listeners.size === 0) return;
  const time = captionTime();
  for (const listener of listeners) listener(time);
}

function tick() {
  emit();
  frame = requestAnimationFrame(tick);
}

/**
 * Starts and stops the loop with demand, so nothing runs when the transcript is
 * closed — which is most of the time, since the panel is one of two views
 * behind a toggle inside a full-screen player.
 */
function start() {
  if (frame !== null) return;
  frame = requestAnimationFrame(tick);

  /*
   * The store as well as the frame loop, and not as belt and braces — the two
   * fail in opposite conditions. `requestAnimationFrame` is the precise one and
   * browsers throttle it hard when the window is not focused, measured here at
   * 1fps, which alone would put every line a full second late. The store keeps
   * publishing on `timeupdate` regardless of focus, holding the floor at the
   * quarter-second browsers fire that at. Whichever fires first moves the line;
   * the other finds nothing to do.
   *
   * It also covers the case with no frame loop at all: seeking while paused,
   * where the position changes exactly once and no rAF is scheduled.
   */
  unsubscribeStore = usePlayer.subscribe(emit);
}

function stop() {
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  unsubscribeStore?.();
  unsubscribeStore = null;
}

/**
 * Calls `listener` with the caption time, once immediately and then once per
 * frame while anything is subscribed.
 *
 * Every subscriber in a given frame receives the *same* number, taken once.
 */
export function subscribeClock(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();

  listener(captionTime());

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** Test seam: the loop is global, so a failed test must not leak into the next. */
export function __resetClockForTests() {
  listeners.clear();
  stop();
}
