import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as FrameClockModule from './frame-clock';

/**
 * A controllable animation-frame scheduler.
 *
 * The point of the module under test is that it opens exactly *one* rAF chain
 * no matter how many components are following the playhead, so the test has to
 * be able to count chains rather than trust a comment. `scheduled` is every
 * callback currently queued; a correct implementation never has more than one.
 */
function fakeRaf() {
  let nextId = 1;
  const scheduled = new Map<number, FrameRequestCallback>();

  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++;
    scheduled.set(id, cb);
    return id;
  };
  globalThis.cancelAnimationFrame = (id: number) => {
    scheduled.delete(id);
  };

  return {
    get pending() {
      return scheduled.size;
    },
    /** Run every queued callback once, as the browser would for one frame. */
    frame(timestampMs: number) {
      const due = [...scheduled.entries()];
      scheduled.clear();
      for (const [, cb] of due) cb(timestampMs);
    },
  };
}

let raf: ReturnType<typeof fakeRaf>;
type FrameClock = typeof FrameClockModule;
let clock: FrameClock;

beforeEach(async () => {
  raf = fakeRaf();
  // Fresh module state per test: the loop and its subscriber set are module
  // singletons, which is the whole design.
  vi.resetModules();
  clock = await import('./frame-clock');
});

afterEach(() => {
  vi.resetModules();
});

describe('subscribeToFrames', () => {
  it('runs one frame loop no matter how many subscribers there are', () => {
    // The defect this module exists to fix: six components, six rAF chains,
    // six reads of the playhead per frame.
    const stops = [0, 1, 2, 3, 4, 5].map(() => clock.subscribeToFrames(() => {}));

    expect(raf.pending).toBe(1);

    raf.frame(16);
    expect(raf.pending).toBe(1);

    for (const stop of stops) stop();
  });

  it('gives every subscriber the same timestamp', () => {
    const seen: number[] = [];
    const stops = [0, 1, 2].map(() => clock.subscribeToFrames((ts) => seen.push(ts)));

    raf.frame(1234.5);

    expect(seen).toEqual([1234.5, 1234.5, 1234.5]);
    for (const stop of stops) stop();
  });

  it('exposes the frame stamp during the frame and nothing outside it', () => {
    /**
     * This is what makes `readPosition`'s memo work. Inside a frame every
     * caller sees one instant, so the first read computes and the rest are
     * free. Outside a frame there is no instant, so a one-shot read after a
     * seek recomputes rather than being answered from a stale cache.
     */
    expect(clock.currentFrameStamp()).toBeNull();

    const seen: (number | null)[] = [];
    const stop = clock.subscribeToFrames(() => seen.push(clock.currentFrameStamp()));

    raf.frame(99);

    expect(seen).toEqual([99]);
    expect(clock.currentFrameStamp()).toBeNull();
    stop();
  });

  it('stops the loop when the last subscriber leaves', () => {
    // A paused player must cost nothing at all.
    const a = clock.subscribeToFrames(() => {});
    const b = clock.subscribeToFrames(() => {});
    expect(raf.pending).toBe(1);

    a();
    expect(raf.pending).toBe(1);

    b();
    expect(raf.pending).toBe(0);
  });

  it('starts again after having been stopped', () => {
    clock.subscribeToFrames(() => {})();
    expect(raf.pending).toBe(0);

    const seen: number[] = [];
    const stop = clock.subscribeToFrames((ts) => seen.push(ts));
    raf.frame(7);

    expect(seen).toEqual([7]);
    stop();
  });

  it('keeps the clock running when a subscriber throws', () => {
    /**
     * One component's bug must not freeze the scrubber, the captions and the
     * countdown along with it. The next frame is queued before the fan-out
     * for exactly this reason.
     */
    const stopBad = clock.subscribeToFrames(() => {
      throw new Error('subscriber blew up');
    });
    const seen: number[] = [];
    const stopGood = clock.subscribeToFrames((ts) => seen.push(ts));

    expect(() => raf.frame(16)).toThrow('subscriber blew up');

    // The chain survived, and the stamp was cleared despite the throw.
    expect(raf.pending).toBe(1);
    expect(clock.currentFrameStamp()).toBeNull();

    stopBad();
    raf.frame(32);
    expect(seen).toEqual([32]);

    stopGood();
  });

  it('tolerates a subscriber unsubscribing from inside the fan-out', () => {
    const seen: string[] = [];
    let stopSelf: (() => void) | null = null;

    stopSelf = clock.subscribeToFrames(() => {
      seen.push('self');
      stopSelf?.();
    });
    const stopOther = clock.subscribeToFrames(() => seen.push('other'));

    expect(() => raf.frame(16)).not.toThrow();
    expect(seen).toEqual(['self', 'other']);

    raf.frame(32);
    expect(seen).toEqual(['self', 'other', 'other']);

    stopOther();
  });
});
