import { describe, expect, it } from "vitest";
import { hasDefects, repairTranscript } from "./transcript-integrity";
import type { TranscriptSegment } from "@/lib/db/schema";

const line = (
  start: number,
  end: number,
  text: string,
  words?: { start: number; end: number; text: string }[],
): TranscriptSegment => ({ start, end, text, ...(words ? { words } : {}) });

/** Every invariant the synchronisation path relies on, asserted as one check. */
function assertSynchronisable(segments: TranscriptSegment[]) {
  let floor = -Infinity;
  for (const segment of segments) {
    expect(Number.isFinite(segment.start)).toBe(true);
    expect(Number.isFinite(segment.end)).toBe(true);
    expect(segment.start).toBeGreaterThanOrEqual(0);
    // Strictly positive span: fillFraction divides by it.
    expect(segment.end).toBeGreaterThan(segment.start);
    // Monotonic and non-overlapping: activeSegmentIndex resumes from its last
    // answer and would walk past anything that went backwards.
    expect(segment.start).toBeGreaterThanOrEqual(floor);
    floor = segment.end;

    if (!segment.words) continue;
    let wordFloor = -Infinity;
    for (const word of segment.words) {
      expect(word.end).toBeGreaterThan(word.start);
      expect(word.start).toBeGreaterThanOrEqual(wordFloor);
      // Words never escape the line that positions them.
      expect(word.start).toBeGreaterThanOrEqual(segment.start);
      expect(word.end).toBeLessThanOrEqual(segment.end);
      wordFloor = word.end;
    }
  }
}

describe("repairTranscript", () => {
  it("returns a clean transcript by reference, so nothing re-measures", () => {
    const input = [line(0, 1, "one"), line(1, 2, "two")];
    const result = repairTranscript(input);

    expect(result.clean).toBe(true);
    expect(hasDefects(result.report)).toBe(false);
    expect(result.segments).toBe(input);
  });

  it("handles an empty or absent transcript", () => {
    expect(repairTranscript([]).segments).toEqual([]);
    expect(repairTranscript(null).segments).toEqual([]);
    expect(repairTranscript(undefined).clean).toBe(true);
  });

  it("orders lines that arrive out of sequence without treating it as damage", () => {
    const result = repairTranscript([line(5, 6, "later"), line(1, 2, "earlier")]);

    expect(result.segments.map((s) => s.text)).toEqual(["earlier", "later"]);
    // Reordering is lossless — no timestamp had to be moved.
    expect(result.report.reordered).toBe(0);
  });

  it("pushes a non-monotonic start forward rather than pulling the previous back", () => {
    // The repair must never make a caption earlier: early reads as broken,
    // late reads as reading along.
    const result = repairTranscript([line(10, 20, "first"), line(15, 25, "second")]);

    expect(result.segments[0].start).toBe(10);
    expect(result.segments[1].start).toBeGreaterThanOrEqual(
      result.segments[0].end,
    );
    assertSynchronisable(result.segments);
  });

  it("trims an overlapping end back to the next start", () => {
    const result = repairTranscript([line(0, 12, "long"), line(10, 15, "next")]);

    expect(result.segments[0].end).toBe(10);
    expect(result.report.overlaps).toBe(1);
    assertSynchronisable(result.segments);
  });

  it("gives a zero-length line a positive span", () => {
    const result = repairTranscript([line(4, 4, "instant")]);

    expect(result.segments[0].end).toBeGreaterThan(result.segments[0].start);
    expect(result.report.degenerate).toBe(1);
  });

  it("repairs an end that precedes its own start", () => {
    const result = repairTranscript([line(9, 3, "backwards")]);

    assertSynchronisable(result.segments);
    expect(result.segments[0].start).toBe(9);
  });

  it("replaces negative and non-finite timestamps", () => {
    const result = repairTranscript([
      line(-5, 2, "negative"),
      line(NaN, 6, "nan"),
      line(7, Infinity, "infinite"),
    ]);

    assertSynchronisable(result.segments);
    expect(result.report.invalid).toBeGreaterThan(0);
  });

  it("drops lines with no usable text", () => {
    const result = repairTranscript([
      line(0, 1, "keep"),
      line(1, 2, "   "),
      { start: 2, end: 3 } as unknown as TranscriptSegment,
    ]);

    expect(result.segments.map((s) => s.text)).toEqual(["keep"]);
    expect(result.report.dropped).toBe(2);
  });

  it("collapses a line emitted twice at the same time", () => {
    const result = repairTranscript([
      line(0, 1, "echo"),
      line(0, 1, "echo"),
      line(1, 2, "next"),
    ]);

    expect(result.segments).toHaveLength(2);
    expect(result.report.duplicates).toBe(1);
  });

  it("keeps a genuine repetition that is spoken twice at different times", () => {
    const result = repairTranscript([
      line(0, 1, "again"),
      line(1, 2, "again"),
    ]);

    expect(result.segments).toHaveLength(2);
    expect(result.report.duplicates).toBe(0);
  });

  describe("word timings", () => {
    it("clamps words to their line rather than widening the line", () => {
      // A seam artefact: word timings and segment boundaries come from
      // different passes and disagree by hundredths of a second.
      const result = repairTranscript([
        line(10, 12, "a b", [
          { start: 9.95, end: 10.9, text: "a" },
          { start: 11, end: 12.4, text: "b" },
        ]),
      ]);

      expect(result.segments[0].start).toBe(10);
      expect(result.segments[0].end).toBe(12);
      assertSynchronisable(result.segments);
    });

    it("monotonises words that step backwards inside a line", () => {
      const result = repairTranscript([
        line(0, 5, "x y z", [
          { start: 0, end: 2, text: "x" },
          { start: 1, end: 3, text: "y" },
          { start: 0.5, end: 4, text: "z" },
        ]),
      ]);

      assertSynchronisable(result.segments);
      expect(result.segments[0].words).toHaveLength(3);
    });

    it("drops a words array that carries nothing usable", () => {
      const result = repairTranscript([
        line(0, 5, "text", [
          { start: 0, end: 1 } as unknown as { start: number; end: number; text: string },
        ]),
      ]);

      expect(result.segments[0].words).toBeUndefined();
    });

    it("leaves a line with no words alone", () => {
      const result = repairTranscript([line(0, 5, "publisher line")]);
      expect(result.segments[0].words).toBeUndefined();
      expect(result.clean).toBe(true);
    });
  });

  it("survives a chunk-boundary overlap, which is how this fails in production", () => {
    // Each chunk is shifted by the measured duration of those before it; a
    // measurement a frame long puts the next chunk's first line early.
    const chunkA = [line(0, 30, "a"), line(30, 59.98, "b")];
    const chunkB = [line(59.9, 90, "c"), line(90, 120, "d")];

    const result = repairTranscript([...chunkA, ...chunkB]);

    assertSynchronisable(result.segments);
    expect(result.segments).toHaveLength(4);
    expect(result.segments.map((s) => s.text)).toEqual(["a", "b", "c", "d"]);
  });

  it("is linear in the number of lines", () => {
    // A three-hour episode is on the order of 10k lines; this must not be
    // quadratic in any of its passes.
    const many = Array.from({ length: 20_000 }, (_, i) => line(i, i + 1, `line ${i}`));

    const started = performance.now();
    const result = repairTranscript(many);
    const elapsed = performance.now() - started;

    expect(result.clean).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});
