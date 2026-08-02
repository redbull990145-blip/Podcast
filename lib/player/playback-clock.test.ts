import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The clock, exercised against a fake audio element and a fake frame loop.
 *
 * The store and the graph are mocked rather than instantiated because what is
 * under test is the *contract* — one sample per frame, shared by every
 * subscriber, latency-corrected, started and stopped with demand. None of that
 * depends on zustand or on Web Audio, and pulling either in would make these
 * tests fail for reasons that have nothing to do with synchronisation.
 */

const audio = {
  currentSrc: "https://example.com/ep.mp3",
  currentTime: 0,
};

let storeTime = 0;
const storeListeners = new Set<() => void>();

vi.mock("./store", () => ({
  getAudio: () => audio,
  usePlayer: {
    getState: () => ({ currentTime: storeTime }),
    subscribe: (listener: () => void) => {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
  },
}));

let latency = 0;
vi.mock("./audio-graph", () => ({ graphOutputLatency: () => latency }));

const { __resetClockForTests, captionTime, outputLatencySeconds, subscribeClock } =
  await import("./playback-clock");

/** Drives the fake rAF queue one frame at a time. */
let frameCallbacks: FrameRequestCallback[] = [];
let nextHandle = 1;

function advanceFrame() {
  const due = frameCallbacks;
  frameCallbacks = [];
  for (const callback of due) callback(performance.now());
}

beforeEach(() => {
  frameCallbacks = [];
  nextHandle = 1;
  audio.currentSrc = "https://example.com/ep.mp3";
  audio.currentTime = 0;
  storeTime = 0;
  latency = 0;
  storeListeners.clear();

  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frameCallbacks.push(cb);
    return nextHandle++;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frameCallbacks = [];
  });
});

afterEach(() => {
  __resetClockForTests();
  vi.unstubAllGlobals();
});

describe("outputLatencySeconds", () => {
  it("is zero when nothing can measure it", () => {
    latency = 0;
    expect(outputLatencySeconds()).toBe(0);
  });

  it("uses a plausible reported latency", () => {
    latency = 0.021;
    expect(outputLatencySeconds()).toBeCloseTo(0.021, 6);
  });

  it.each([-0.01, 30, Number.NaN, Number.POSITIVE_INFINITY, 0.5])(
    "rejects an implausible reported latency of %s",
    (reported) => {
      latency = reported;
      // A wrong correction is worse than none: it would be an invisible,
      // uncorrectable offset on every caption.
      expect(outputLatencySeconds()).toBe(0);
    },
  );
});

describe("captionTime", () => {
  it("reads the element, not the store, when media is loaded", () => {
    audio.currentTime = 12.5;
    storeTime = 9;
    expect(captionTime()).toBe(12.5);
  });

  it("subtracts output latency, so captions do not lead the sound", () => {
    audio.currentTime = 12.5;
    latency = 0.04;
    expect(captionTime()).toBeCloseTo(12.46, 6);
  });

  it("falls back to the store when the element has no media", () => {
    // An element with no source reports 0 forever, which would peg every
    // caption to the first line.
    audio.currentSrc = "";
    storeTime = 42;
    expect(captionTime()).toBe(42);
  });
});

describe("subscribeClock", () => {
  it("delivers the current time immediately, without waiting for a frame", () => {
    audio.currentTime = 3;
    const seen: number[] = [];

    subscribeClock((t) => seen.push(t));

    expect(seen).toEqual([3]);
  });

  it("gives every subscriber the same sample within a frame", () => {
    // The whole reason this module exists: two loops sampling separately can
    // straddle a line boundary and disagree about which line is current.
    const a: number[] = [];
    const b: number[] = [];

    subscribeClock((t) => a.push(t));
    subscribeClock((t) => b.push(t));

    for (const time of [1, 2, 3]) {
      audio.currentTime = time;
      advanceFrame();
    }

    expect(a).toEqual(b);
  });

  it("samples once per frame however many subscribers there are", () => {
    let reads = 0;
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      get() {
        reads += 1;
        return 5;
      },
    });

    subscribeClock(() => {});
    subscribeClock(() => {});
    subscribeClock(() => {});
    reads = 0;

    advanceFrame();

    expect(reads).toBe(1);
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      writable: true,
      value: 5,
    });
  });

  it("runs no frame loop until something subscribes", () => {
    expect(frameCallbacks).toHaveLength(0);
  });

  it("stops the loop when the last subscriber leaves", () => {
    const stopA = subscribeClock(() => {});
    const stopB = subscribeClock(() => {});

    advanceFrame();
    expect(frameCallbacks.length).toBeGreaterThan(0);

    stopA();
    advanceFrame();
    expect(frameCallbacks.length).toBeGreaterThan(0);

    stopB();
    advanceFrame();
    expect(frameCallbacks).toHaveLength(0);
  });

  it("keeps updating from the store when frames are starved", () => {
    // An unfocused window throttles rAF to about 1fps. `timeupdate` keeps
    // arriving regardless, which holds the floor at a quarter-second.
    const seen: number[] = [];
    subscribeClock((t) => seen.push(t));
    seen.length = 0;

    audio.currentTime = 7;
    for (const listener of storeListeners) listener();

    expect(seen).toEqual([7]);
  });

  it("updates a paused seek, where there is no frame loop at all", () => {
    audio.currentSrc = "";
    const seen: number[] = [];
    subscribeClock((t) => seen.push(t));
    seen.length = 0;

    storeTime = 99;
    for (const listener of storeListeners) listener();

    expect(seen).toEqual([99]);
  });

  it("unsubscribes cleanly from the store as well as the frame loop", () => {
    const stop = subscribeClock(() => {});
    expect(storeListeners.size).toBe(1);
    stop();
    expect(storeListeners.size).toBe(0);
  });

  it("tolerates a subscriber leaving during its own callback", () => {
    // Mutating the listener set from inside the emit loop. The immediate
    // first call happens before `stop` exists, so the unsubscribe is deferred
    // to the first real frame.
    const seen: number[] = [];
    let stop: (() => void) | undefined;
    stop = subscribeClock((t) => {
      seen.push(t);
      stop?.();
    });

    audio.currentTime = 4;
    expect(() => advanceFrame()).not.toThrow();
    expect(seen).toEqual([0, 4]);

    // Genuinely gone: a later frame must not call it again.
    audio.currentTime = 9;
    advanceFrame();
    expect(seen).toEqual([0, 4]);
  });
});
