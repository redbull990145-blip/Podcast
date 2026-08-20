/**
 * A playback clock smooth enough to drive a caption sweep.
 *
 * **The audio element's clock is not continuous.** `currentTime` is a sampled
 * value, not a live one: the HTML specification mandates no particular accuracy,
 * Firefox defines an audio "frame" as 40ms and advances the value 25 times a
 * second, and other engines quantise it differently again. Read it on every
 * animation frame at 120Hz and it returns the *same number* four or five times
 * in a row, then jumps by 40ms.
 *
 * For a progress bar that is invisible — the bar moves a fraction of a pixel
 * either way. For a highlight sweeping through a word it is the whole problem:
 * the fill freezes, lurches, freezes, lurches. It reads exactly like the
 * captions being out of sync with the audio, and no amount of correcting the
 * *timestamps* fixes it, because the timestamps were never the thing that was
 * wrong.
 *
 * So the clock is modelled rather than sampled. Between updates it advances by
 * real elapsed wall time; when the audio element does report a new value the
 * model is eased toward it rather than snapped to it. What comes out is
 * continuous at any refresh rate, and tracks the audio's own clock to within a
 * millisecond or two over any interval that matters.
 *
 * Pure and platform-free on purpose: the same reasoning applies to the Android
 * player, whose native position callbacks are coarser still.
 */

/**
 * How much of the remaining error is taken out per frame, 0–1.
 *
 * The tension is entirely between two failure modes. Too high and the
 * quantisation it exists to hide comes straight back through — at 1.0 this is
 * just `currentTime` again. Too low and the model takes visibly long to catch
 * up after a stall, drifting ahead of the audio in the meantime.
 *
 * 0.08 removes about half the error every eight frames, so a 40ms quantisation
 * step is absorbed over roughly a tenth of a second — below the threshold at
 * which a moving edge reads as anything but smooth, and fast enough that the
 * model never wanders more than a few milliseconds from the truth.
 */
const SLEW = 0.08;

/**
 * The disagreement, in seconds, past which easing is the wrong response.
 *
 * A seek, a loop, a track change or a long stall is a genuine discontinuity —
 * the position really did move, and easing toward it would send the captions
 * gliding through every line in between at high speed, which looks far worse
 * than a cut. Anything this large is a jump and is treated as one.
 *
 * Comfortably above any quantisation step (the coarsest in the wild is ~0.25s
 * from `timeupdate`-driven engines) and comfortably below the smallest seek
 * anyone performs deliberately.
 */
const JUMP_SEC = 0.4;

/**
 * The longest gap between reads that is still worth extrapolating across.
 *
 * A backgrounded tab stops firing animation frames; when it returns, the wall
 * clock has advanced by minutes while the audio may have been paused, stalled,
 * or playing. Extrapolating across that produces a wildly wrong position, so
 * the model re-anchors instead.
 */
const MAX_STEP_SEC = 1;

export class PlaybackClock {
  /** The modelled position, in seconds. Null until the first read anchors it. */
  private position: number | null = null;
  /** `performance.now()` at the last read, in ms. */
  private lastWallMs = 0;

  /**
   * The smoothed position for a given raw reading.
   *
   * `nowMs` is passed in rather than read here so the whole class is a pure
   * function of its arguments and can be tested without faking timers.
   */
  read(rawSec: number, options: { playing: boolean; rate: number; nowMs: number }): number {
    const { playing, rate, nowMs } = options;

    /**
     * Paused, the audio clock is not merely accurate — it is the only truth
     * there is. Nothing is advancing, so there is nothing to model, and a
     * listener scrubbing while paused must see exactly where they put the
     * playhead rather than a value easing toward it.
     */
    if (!playing) {
      this.position = rawSec;
      this.lastWallMs = nowMs;
      return rawSec;
    }

    if (this.position === null) {
      this.position = rawSec;
      this.lastWallMs = nowMs;
      return rawSec;
    }

    const elapsedSec = (nowMs - this.lastWallMs) / 1000;
    this.lastWallMs = nowMs;

    // A frame that arrived from the past, or after the tab was asleep. Neither
    // can be extrapolated across.
    if (elapsedSec < 0 || elapsedSec > MAX_STEP_SEC) {
      this.position = rawSec;
      return rawSec;
    }

    // Where the model says we should be: the last position plus however much
    // real time has passed, scaled by how fast the audio is being played.
    const predicted = this.position + elapsedSec * rate;

    // A real discontinuity. Cut rather than glide.
    if (Math.abs(rawSec - predicted) > JUMP_SEC) {
      this.position = rawSec;
      return rawSec;
    }

    /**
     * Never backwards while playing.
     *
     * The eased value can land a millisecond or two behind its predecessor when
     * the raw clock is lagging its own quantisation step. That is inaudible but
     * very visible: a sweep that inches backwards mid-word reads as a glitch,
     * and a caption index derived from it can flicker between two lines.
     */
    const eased = predicted + (rawSec - predicted) * SLEW;
    this.position = Math.max(this.position, eased);
    return this.position;
  }

  /**
   * Forget the model.
   *
   * For the discontinuities that are known in advance rather than inferred —
   * loading a different episode, a seek the player itself initiated. Cheaper
   * and surer than waiting for the jump threshold to notice.
   */
  reset(): void {
    this.position = null;
    this.lastWallMs = 0;
  }
}

/**
 * How far ahead of the audio the captions are drawn, in ms.
 *
 * Not a fudge factor for bad timestamps — a correction for the delay between
 * this code deciding what to paint and a person hearing the corresponding
 * sound. Layout, paint and compositing cost a frame or two; the operating
 * system's audio buffer costs more; Bluetooth headphones can add over a
 * hundred milliseconds on their own. All of it lands in the same direction, so
 * a highlight driven by the exact playhead is always slightly late, and reads
 * as the captions trailing the voice even when every timestamp is perfect.
 *
 * Deliberately modest. Being a little late is unremarkable; being *early* means
 * lighting a word before it has been said, which is far more noticeable because
 * it spoils what comes next. When in doubt this number should come down, not up.
 */
export const CAPTION_LEAD_MS = 80;
