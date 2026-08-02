import { describe, expect, it } from "vitest";
import { activeSegmentIndex, captionLines } from "./captions";
import { fillFraction } from "./caption-motion";
import { repairTranscript } from "./transcript-integrity";
import { toTranscriptTime } from "./caption-sync";
import type { TranscriptSegment } from "@/lib/db/schema";

/**
 * Synchronisation under every way playback actually behaves.
 *
 * `activeSegmentIndex` is an optimisation: it carries the previous answer as a
 * hint so that normal playback costs a constant-time check instead of a scan.
 * An optimisation is only correct if it agrees with the definition it replaces,
 * so almost every test here is *differential* — drive the hint-carrying version
 * through a scenario and assert at every step that it returned exactly what an
 * unoptimised scan would have. That catches a whole class of bug that
 * hand-written expectations miss, because it does not require me to have
 * guessed which step would break.
 *
 * The scenarios are the ones a listener produces: seeking, pausing, stalling on
 * a slow connection, changing speed, backgrounding the tab. Each is expressed
 * as a sequence of clock samples, because that is all the synchronisation layer
 * ever sees — it has no concept of "seek" or "buffering", only of time that
 * jumped, stood still, or advanced.
 */

/**
 * The definition `activeSegmentIndex` optimises: the last line that has started.
 *
 * Deliberately the slowest, most obviously-correct implementation.
 */
function groundTruth(segments: TranscriptSegment[], time: number): number {
  let answer = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i].start <= time) answer = i;
  }
  return answer;
}

/**
 * Replays a series of clock samples the way the panel does, carrying the hint
 * forward, and asserts the result matches ground truth at every one.
 *
 * Returns the indices seen, so a caller can additionally assert on the shape of
 * the progression (never backwards, never skipping, and so on).
 */
function replay(segments: TranscriptSegment[], samples: number[]): number[] {
  const seen: number[] = [];
  let previous = -1;

  for (const time of samples) {
    const index = activeSegmentIndex(segments, time, previous);
    expect(index, `at t=${time}`).toBe(groundTruth(segments, time));
    seen.push(index);
    previous = index;
  }

  return seen;
}

/** Clock samples for `seconds` of playback at `rate`, sampled at 60fps. */
function playback(from: number, seconds: number, rate = 1): number[] {
  const samples: number[] = [];
  const step = (1 / 60) * rate;
  for (let t = from; t <= from + seconds * rate; t += step) samples.push(t);
  return samples;
}

/** A transcript of `count` lines, each `spoken` long with `gap` of silence after. */
function transcript(count: number, spoken = 2.5, gap = 0.5): TranscriptSegment[] {
  return Array.from({ length: count }, (_, i) => {
    const start = i * (spoken + gap);
    return {
      start,
      end: start + spoken,
      text: `line ${i} alpha bravo charlie`,
      words: ["line", `${i}`, "alpha", "bravo", "charlie"].map((text, w) => ({
        start: start + w * (spoken / 5),
        end: start + (w + 1) * (spoken / 5),
        text,
      })),
    };
  });
}

const LINES = transcript(400);

describe("playback scenarios", () => {
  it("normal playback visits every line, in order, none skipped", () => {
    const seen = replay(LINES, playback(0, 60));

    // Monotonic, and never advancing by more than one line at 1x — a line is
    // three seconds and a frame is sixteen milliseconds.
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
      expect(seen[i] - seen[i - 1]).toBeLessThanOrEqual(1);
    }
    expect(new Set(seen).size).toBeGreaterThan(15);
  });

  it("holds the line through the silence after it, rather than clearing", () => {
    // Between lines nothing is being spoken, but the last thing said is still
    // the thing on screen. Clearing would blank the transcript in every pause.
    const lines = transcript(3, 2, 1);
    expect(activeSegmentIndex(lines, 2.5, 0)).toBe(0);
    expect(activeSegmentIndex(lines, 2.99, 0)).toBe(0);
    expect(activeSegmentIndex(lines, 3, 0)).toBe(1);
  });

  it.each([0.5, 0.75, 1, 1.5, 2, 3])("stays correct at %sx", (rate) => {
    replay(LINES, playback(0, 40, rate));
  });

  it("survives a rate change mid-playback", () => {
    const samples = [
      ...playback(0, 20, 1),
      ...playback(20, 20, 3),
      ...playback(80, 20, 0.5),
    ];
    replay(LINES, samples);
  });

  it("holds still while paused and resumes cleanly", () => {
    const paused = Array.from({ length: 120 }, () => 42.3);
    const seen = replay(LINES, [...playback(40, 3), ...paused, ...playback(42.3, 5)]);
    expect(new Set(paused.map(() => seen[130])).size).toBe(1);
  });

  it("holds still while stalled on a slow connection", () => {
    // Buffering looks identical to pausing from here: the clock stops.
    const stalled = Array.from({ length: 240 }, () => 100.5);
    replay(LINES, [...playback(98, 2.5), ...stalled, ...playback(100.5, 4)]);
  });

  it("lands on the right line after a forward seek", () => {
    replay(LINES, [...playback(0, 5), 600, ...playback(600, 5)]);
  });

  it("lands on the right line after a backward seek", () => {
    // The hint is now ahead of the time, so the scan has to restart. This is
    // the path that a naive resume-from-hint gets wrong.
    replay(LINES, [...playback(600, 5), 12, ...playback(12, 5)]);
  });

  it("survives scrubbing — many seeks in both directions with no settling", () => {
    const scrub: number[] = [];
    // Deterministic pseudo-random walk, so a failure is reproducible.
    let seed = 12_345;
    for (let i = 0; i < 2_000; i += 1) {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      scrub.push((seed / 2_147_483_648) * 1_200);
    }
    replay(LINES, scrub);
  });

  it("is correct on sparse samples, as in a backgrounded tab", () => {
    // rAF throttles to roughly 1fps unfocused; the store keeps publishing on
    // timeupdate. Either way the samples are far apart and may skip lines.
    const sparse = Array.from({ length: 120 }, (_, i) => i * 1);
    const seen = replay(LINES, sparse);
    // Skipping ahead by more than one line is correct here — those lines were
    // genuinely spoken between samples.
    expect(Math.max(...seen)).toBeGreaterThan(30);
  });

  it("handles a seek to a position between two lines", () => {
    const lines = transcript(5, 2, 1);
    // 2.5s is after line 0 ended and before line 1 starts.
    expect(activeSegmentIndex(lines, 2.5, 3)).toBe(0);
  });
});

describe("edge timestamps", () => {
  const lines = transcript(5, 2, 1);

  it("reports nothing before the first line starts", () => {
    expect(activeSegmentIndex(lines, 0, -1)).toBe(0);
    expect(activeSegmentIndex(lines, -1, -1)).toBe(-1);
    expect(activeSegmentIndex(lines, -0.001, 4)).toBe(-1);
  });

  it("holds the last line past the end of the transcript", () => {
    expect(activeSegmentIndex(lines, 1_000, 0)).toBe(lines.length - 1);
  });

  it("switches exactly on a boundary, not a frame either side", () => {
    const boundary = lines[1].start;
    expect(activeSegmentIndex(lines, boundary - 1e-6, 0)).toBe(0);
    expect(activeSegmentIndex(lines, boundary, 0)).toBe(1);
  });

  it("handles an empty transcript", () => {
    expect(activeSegmentIndex([], 5, -1)).toBe(-1);
    expect(activeSegmentIndex([], 0, 3)).toBe(-1);
  });

  it("handles a single-line transcript", () => {
    const one = transcript(1);
    expect(activeSegmentIndex(one, -1, -1)).toBe(-1);
    expect(activeSegmentIndex(one, 0, -1)).toBe(0);
    expect(activeSegmentIndex(one, 10_000, 0)).toBe(0);
  });

  it("tolerates a nonsense hint", () => {
    for (const hint of [-99, 0, 4, 999, Number.NaN]) {
      expect(activeSegmentIndex(lines, 7, hint)).toBe(groundTruth(lines, 7));
    }
  });

  it("handles a very short clip", () => {
    const clip: TranscriptSegment[] = [{ start: 0, end: 0.4, text: "hi there" }];
    replay(clip, playback(0, 1));
    expect(fillFraction(clip[0], 0.4)).toBe(1);
  });
});

describe("the fill under the same scenarios", () => {
  const lines = transcript(20);

  it("never runs backwards during forward playback", () => {
    for (let i = 0; i < lines.length; i += 1) {
      let previous = -1;
      for (let t = lines[i].start; t <= lines[i].end; t += 0.01) {
        const fill = fillFraction(lines[i], t);
        expect(fill).toBeGreaterThanOrEqual(previous);
        previous = fill;
      }
    }
  });

  it("is always within [0, 1], including outside the line", () => {
    for (const t of [-100, -1, 0, 1.3, 2.5, 3, 1_000]) {
      const fill = fillFraction(lines[0], t);
      expect(fill).toBeGreaterThanOrEqual(0);
      expect(fill).toBeLessThanOrEqual(1);
    }
  });

  it("recomputes from the clock alone, so a seek needs no reset", () => {
    // The fill is a pure function of (segment, time). This is what makes
    // repeated seeking safe: there is no accumulated state to go stale.
    const line = lines[7];
    const forward = fillFraction(line, line.start + 1.2);
    const afterSeekingAway = [0, 500, line.start + 1.2].map((t) =>
      fillFraction(line, t),
    );
    expect(afterSeekingAway[2]).toBe(forward);
  });
});

describe("the whole pipeline, end to end", () => {
  it("keeps a repaired transcript synchronisable after line splitting", () => {
    // Damaged input → repair → split into caption lines → drive playback.
    // This is the path a real transcript takes, and each stage rewrites the
    // timings, so the invariant has to survive all of them.
    const damaged: TranscriptSegment[] = [
      { start: 0, end: 40, text: Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ") },
      { start: 38, end: 70, text: Array.from({ length: 50 }, (_, i) => `x${i}`).join(" ") },
      { start: 70, end: 70, text: "zero length" },
      { start: -5, end: 12, text: "negative start" },
    ];

    const lines = captionLines(repairTranscript(damaged).segments);

    expect(lines.length).toBeGreaterThan(4);
    let floor = -Infinity;
    for (const line of lines) {
      expect(line.start).toBeGreaterThanOrEqual(floor);
      expect(line.end).toBeGreaterThanOrEqual(line.start);
      floor = line.start;
    }

    replay(lines, playback(0, 80));
  });

  it("applies the caption offset without breaking monotonicity", () => {
    // The ad-stitch shift moves the whole clock, not the transcript.
    const offset = 30;
    const samples = playback(0, 90).map((t) => toTranscriptTime(t, offset));
    replay(LINES, samples);
  });
});
