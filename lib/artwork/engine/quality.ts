/**
 * Adaptive quality.
 *
 * The engine has one hard obligation to the rest of the app: it must never make
 * anything worse. A cover that animates beautifully on a desktop GPU and drops
 * the Now Playing sheet to 30fps on a four-year-old phone has failed, and it has
 * failed in the way that is hardest to notice in development.
 *
 * So the renderer measures itself and steps down when it cannot keep up, ending
 * — if it has to — by removing itself entirely and leaving the static artwork
 * that was underneath the whole time. Giving up is a supported outcome here, not
 * an error path.
 *
 * Pure, so the escalation logic can be tested without a GPU.
 */

/**
 * What the renderer should be doing.
 *
 * Ordered, and only ever traversed downward. There is no recovery step: a
 * device that could not sustain the frame rate a moment ago is unlikely to have
 * become faster, and a renderer that oscillates between quality levels is more
 * distracting than one that settles on the lower.
 */
export type QualityLevel = 0 | 1 | 2 | 3;

export const QUALITY = {
  /** Full device pixel ratio, capped at 2. */
  FULL: 0 as QualityLevel,
  /** Three quarters of the pixels. */
  REDUCED: 1 as QualityLevel,
  /** One device pixel per CSS pixel. */
  MINIMAL: 2 as QualityLevel,
  /** Stop rendering and show the static artwork. */
  DISABLED: 3 as QualityLevel,
} as const;

/** Device pixel ratio for each level. `DISABLED` never renders, so it has none. */
export function dprFor(level: QualityLevel, devicePixelRatio: number): number {
  const capped = Math.min(devicePixelRatio, 2);
  if (level === QUALITY.FULL) return capped;
  if (level === QUALITY.REDUCED) return Math.min(capped, 1.5);
  return 1;
}

/**
 * A frame is late past this. About 20ms — comfortably beyond a 60Hz budget, so
 * ordinary jitter does not count, but well short of the 33ms that would mean
 * the frame rate had already halved.
 */
const LATE_FRAME_MS = 20;

/**
 * Frames in the rolling window.
 *
 * Two seconds at 60fps. Long enough that a burst of jank from something else on
 * the page — a route transition, an image decode — cannot trigger a downgrade
 * on its own, which matters because this engine shares the main thread with a
 * player that is doing real work.
 */
const WINDOW = 120;

/**
 * Share of the window that must be late before stepping down.
 *
 * A quarter rather than a half: by the time half the frames are late the
 * animation is visibly stuttering, and the point is to step down before anybody
 * sees it rather than after.
 */
const LATE_FRACTION = 0.25;

export type QualityMonitor = {
  /** Feeds a frame delta in seconds. Returns the level the renderer should now use. */
  record: (deltaSeconds: number) => QualityLevel;
  readonly level: QualityLevel;
};

export function createQualityMonitor(initial: QualityLevel = QUALITY.FULL): QualityMonitor {
  const frames = new Float32Array(WINDOW);
  let count = 0;
  let cursor = 0;
  let level = initial;

  return {
    get level() {
      return level;
    },

    record(deltaSeconds) {
      const ms = deltaSeconds * 1000;

      /*
       * A frame longer than a third of a second is a stall, not slowness — a
       * tab regaining focus, a long task elsewhere on the page, a device waking.
       * Counting it would let a single unrelated hitch push the engine a whole
       * quality level down, which it would then never recover from.
       */
      if (ms > 333) return level;

      frames[cursor] = ms;
      cursor = (cursor + 1) % WINDOW;
      if (count < WINDOW) count += 1;

      // Judge only on a full window, so the first frames after mount — which
      // include shader compilation and the first texture upload, and are always
      // slow — are never the evidence.
      if (count < WINDOW) return level;

      let late = 0;
      for (let i = 0; i < WINDOW; i += 1) {
        if (frames[i] > LATE_FRAME_MS) late += 1;
      }

      if (late / WINDOW > LATE_FRACTION && level < QUALITY.DISABLED) {
        level = (level + 1) as QualityLevel;
        // The window is cleared rather than kept: the frames that justified this
        // step were measured at the old quality, and leaving them in would
        // trigger the next step immediately, walking straight to DISABLED.
        count = 0;
        cursor = 0;
      }

      return level;
    },
  };
}
