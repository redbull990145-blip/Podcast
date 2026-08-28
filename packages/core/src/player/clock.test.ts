import { describe, expect, it } from 'vitest';
import { CAPTION_LEAD_MS, PlaybackClock } from './clock.ts';

/**
 * A media element whose clock only advances in discrete steps, which is what
 * every real one does. `step` is the quantisation: 40ms is Firefox's, 250ms is
 * the worst case for engines driven off `timeupdate`.
 */
function quantised(step: number) {
  return (trueSec: number) => Math.floor(trueSec / step) * step;
}

/** Drive the clock across `frames` at `hz`, returning what it reported. */
function run(
  clock: PlaybackClock,
  { frames, hz, step, rate = 1, startSec = 0 }:
    { frames: number; hz: number; step: number; rate?: number; startSec?: number },
): { reported: number[]; truth: number[] } {
  const sample = quantised(step);
  const reported: number[] = [];
  const truth: number[] = [];

  for (let i = 0; i < frames; i += 1) {
    const nowMs = (i / hz) * 1000;
    const trueSec = startSec + (i / hz) * rate;
    truth.push(trueSec);
    reported.push(clock.read(sample(trueSec), { playing: true, rate, nowMs }));
  }

  return { reported, truth };
}

describe('PlaybackClock', () => {
  it('advances on every frame even when the audio clock has not moved', () => {
    // The defect this exists for: at 120Hz against a 40ms clock, the raw value
    // repeats four or five times in a row and the sweep visibly freezes.
    const { reported } = run(new PlaybackClock(), { frames: 40, hz: 120, step: 0.04 });

    const repeats = reported.filter((value, i) => i > 0 && value === reported[i - 1]!);
    expect(repeats).toHaveLength(0);
  });

  it('never runs backwards while playing', () => {
    const { reported } = run(new PlaybackClock(), { frames: 200, hz: 120, step: 0.04 });
    for (let i = 1; i < reported.length; i += 1) {
      expect(reported[i]!).toBeGreaterThanOrEqual(reported[i - 1]!);
    }
  });

  it('tracks the true position closely once settled', () => {
    const { reported, truth } = run(new PlaybackClock(), { frames: 240, hz: 60, step: 0.04 });

    // Ignore the first few frames, which are still converging from the anchor.
    for (let i = 30; i < reported.length; i += 1) {
      expect(Math.abs(reported[i]! - truth[i]!)).toBeLessThan(0.06);
    }
  });

  it('stays smooth against a very coarse clock', () => {
    // 250ms is the `timeupdate` worst case. The step between consecutive
    // reported values should still be roughly one frame's worth of time.
    const { reported } = run(new PlaybackClock(), { frames: 120, hz: 60, step: 0.25 });

    for (let i = 40; i < reported.length; i += 1) {
      const delta = reported[i]! - reported[i - 1]!;
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThan(0.05);
    }
  });

  it('follows a faster playback rate', () => {
    const { reported, truth } = run(new PlaybackClock(), {
      frames: 240,
      hz: 60,
      step: 0.04,
      rate: 2,
    });
    expect(Math.abs(reported.at(-1)! - truth.at(-1)!)).toBeLessThan(0.06);
  });

  it('cuts to a seek rather than gliding through the lines between', () => {
    const clock = new PlaybackClock();
    run(clock, { frames: 60, hz: 60, step: 0.04 });

    // Easing toward a distant target would sweep every caption in between at
    // high speed, which looks far worse than a cut.
    const afterSeek = clock.read(600, { playing: true, rate: 1, nowMs: 1016 });
    expect(afterSeek).toBe(600);
  });

  it('takes the raw value verbatim while paused', () => {
    const clock = new PlaybackClock();
    // Scrubbing while paused must land exactly where it was put.
    expect(clock.read(42.5, { playing: false, rate: 1, nowMs: 0 })).toBe(42.5);
    expect(clock.read(11.25, { playing: false, rate: 1, nowMs: 16 })).toBe(11.25);
  });

  it('re-anchors after the tab was backgrounded', () => {
    const clock = new PlaybackClock();
    clock.read(10, { playing: true, rate: 1, nowMs: 0 });
    // Animation frames stop in a hidden tab; minutes of wall time pass that the
    // audio may not have spent playing. Extrapolating across it is nonsense.
    expect(clock.read(12, { playing: true, rate: 1, nowMs: 300_000 })).toBe(12);
  });

  it('re-anchors rather than extrapolating a frame from the past', () => {
    const clock = new PlaybackClock();
    clock.read(10, { playing: true, rate: 1, nowMs: 1000 });
    expect(clock.read(10.5, { playing: true, rate: 1, nowMs: 900 })).toBe(10.5);
  });

  it('starts from wherever it is first read', () => {
    expect(new PlaybackClock().read(97.5, { playing: true, rate: 1, nowMs: 0 })).toBe(97.5);
  });

  it('forgets its model on reset', () => {
    const clock = new PlaybackClock();
    run(clock, { frames: 60, hz: 60, step: 0.04 });
    clock.reset();
    expect(clock.read(0, { playing: true, rate: 1, nowMs: 5000 })).toBe(0);
  });

  /**
   * The refresh rate must not change the physics.
   *
   * The smoothing used to be applied once per call, which made the settle time
   * a function of the display: a 144Hz panel ran the same fraction 2.4x more
   * often and pulled the error out that much faster, so the fast display got
   * the *worse* sweep. These pin the behaviour to wall-clock time instead.
   */
  it('settles over the same wall time at any refresh rate', () => {
    /**
     * Settle *time* is the thing that must not move, not the instantaneous
     * reading. Two rates sampling the same 40ms staircase land on different
     * points of a step, which is phase, not physics — asserting on it would
     * pin a number that means nothing.
     *
     * So: anchor the model, hand it a 200ms discontinuity too small to trip
     * the jump threshold, and count the wall time it takes to come back within
     * 20ms of the truth. Before this was rescaled by elapsed time the answer
     * ran 467ms at 60Hz and 117ms at 240Hz — the same model behaving four
     * different ways on four different displays.
     */
    const settleMs = (hz: number) => {
      const clock = new PlaybackClock();
      const dt = 1 / hz;

      // A second of ordinary playback, so the model is tracking before the
      // discontinuity arrives.
      for (let i = 0; i < hz; i += 1) {
        clock.read(i * dt, { playing: true, rate: 1, nowMs: i * dt * 1000 });
      }

      const startMs = hz * dt * 1000;
      for (let i = 1; i < hz * 3; i += 1) {
        const trueSec = 1 + 0.2 + i * dt;
        const value = clock.read(trueSec, {
          playing: true,
          rate: 1,
          nowMs: startMs + i * dt * 1000,
        });
        if (Math.abs(value - trueSec) < 0.02) return i * dt * 1000;
      }

      return Infinity;
    };

    const sixty = settleMs(60);
    expect(sixty).toBeLessThan(1000);

    for (const hz of [100, 140, 240]) {
      // Within a tenth of the 60Hz figure at every rate this app can be shown
      // on. The old per-call slew was out by a factor of four.
      expect(Math.abs(settleMs(hz) - sixty)).toBeLessThan(sixty * 0.1);
    }
  });

  it('tracks the true position just as closely at 140Hz as at 60Hz', () => {
    const { reported, truth } = run(new PlaybackClock(), { frames: 560, hz: 140, step: 0.04 });

    for (let i = 70; i < reported.length; i += 1) {
      expect(Math.abs(reported[i]! - truth[i]!)).toBeLessThan(0.06);
    }
  });

  it('stays smooth at 140Hz against a coarse clock', () => {
    // The whole point of the class, at the rate this app targets: no frame may
    // repeat a value, and none may lurch.
    const { reported } = run(new PlaybackClock(), { frames: 280, hz: 140, step: 0.25 });

    for (let i = 100; i < reported.length; i += 1) {
      const delta = reported[i]! - reported[i - 1]!;
      expect(delta).toBeGreaterThan(0);
      // One frame at 140Hz is ~7.1ms; allow generous headroom but nothing
      // that would read as a jump.
      expect(delta).toBeLessThan(0.02);
    }
  });

  it('does not advance when read more than once in the same frame', () => {
    /**
     * Every extra consumer used to take its own easing step, so mounting the
     * transcript panel beside the captions changed how the captions moved.
     * A repeated read at the same instant must be free and identical.
     */
    const clock = new PlaybackClock();
    run(clock, { frames: 60, hz: 60, step: 0.04 });

    const first = clock.read(1.0, { playing: true, rate: 1, nowMs: 1016 });
    const second = clock.read(1.0, { playing: true, rate: 1, nowMs: 1016 });
    const third = clock.read(1.0, { playing: true, rate: 1, nowMs: 1016 });

    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});

describe('CAPTION_LEAD_MS', () => {
  it('is small enough that it can never light a word early by much', () => {
    // Late is unremarkable; early spoils the next word. If this ever needs
    // raising past a tenth of a second, something else is wrong.
    expect(CAPTION_LEAD_MS).toBeGreaterThan(0);
    expect(CAPTION_LEAD_MS).toBeLessThanOrEqual(100);
  });
});
