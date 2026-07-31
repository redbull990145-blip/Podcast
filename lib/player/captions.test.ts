import { describe, expect, it } from "vitest";
import { activeSegmentIndex, captionLines } from "./captions";
import type { TranscriptSegment, TranscriptWord } from "@/lib/db/schema";

/**
 * A segment of `count` one-second words starting at `start`.
 *
 * The words are all different on purpose: a run of one repeated word is a
 * repetition loop, and `captionLines` now collapses those (see
 * lib/transcript/repetition.ts), so a fixture built from one word would be
 * testing the collapse rather than the line breaking.
 */
function spoken(start: number, count: number): TranscriptSegment {
  const words: TranscriptWord[] = Array.from({ length: count }, (_, i) => ({
    start: start + i,
    end: start + i + 1,
    text: `w${i}`,
  }));
  return {
    start,
    end: start + count,
    text: words.map((w) => w.text).join(" "),
    words,
  };
}

const segments = [
  { start: 0, end: 3, text: "one" },
  { start: 3, end: 6, text: "two" },
  { start: 6, end: 9, text: "three" },
  { start: 9, end: 12, text: "four" },
];

describe("activeSegmentIndex", () => {
  it("returns -1 before the first line", () => {
    expect(activeSegmentIndex([{ start: 5, end: 8, text: "x" }], 2)).toBe(-1);
  });

  it("returns -1 for an empty transcript", () => {
    expect(activeSegmentIndex([], 10)).toBe(-1);
  });

  it("finds the line covering the current time", () => {
    expect(activeSegmentIndex(segments, 4)).toBe(1);
    expect(activeSegmentIndex(segments, 7.5)).toBe(2);
  });

  it("treats a boundary as the start of the next line", () => {
    expect(activeSegmentIndex(segments, 6)).toBe(2);
  });

  it("stays on the last line past the end", () => {
    expect(activeSegmentIndex(segments, 9999)).toBe(3);
  });

  it("advances by one from the previous index during normal playback", () => {
    expect(activeSegmentIndex(segments, 3.1, 0)).toBe(1);
  });

  it("recovers when the hint is ahead of the time, as after a backwards seek", () => {
    // Hint says line 3, but we jumped back to 1s — must not stay stuck ahead.
    expect(activeSegmentIndex(segments, 1, 3)).toBe(0);
  });

  it("ignores an out-of-range hint", () => {
    expect(activeSegmentIndex(segments, 7, 99)).toBe(2);
    expect(activeSegmentIndex(segments, 7, -5)).toBe(2);
  });

  it("gives the same answer with or without a hint", () => {
    for (let t = 0; t <= 13; t += 0.5) {
      const withoutHint = activeSegmentIndex(segments, t);
      for (let hint = -1; hint <= segments.length; hint += 1) {
        expect(activeSegmentIndex(segments, t, hint)).toBe(withoutHint);
      }
    }
  });
});

describe("captionLines", () => {
  it("leaves a line that is already short alone, by reference", () => {
    const segment = { start: 0, end: 3, text: "short enough already" };
    const lines = captionLines([segment]);
    expect(lines).toHaveLength(1);
    // Identity matters: the word cache and the row height table key off it.
    expect(lines[0]).toBe(segment);
  });

  it("breaks up a thirty-second paragraph into readable lines", () => {
    // The shape Whisper actually returns: half a minute, dozens of words.
    const lines = captionLines([spoken(0, 30)]);

    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) {
      expect(line.text.split(" ").length).toBeLessThanOrEqual(9);
      expect(line.end - line.start).toBeLessThanOrEqual(9);
    }
  });

  it("covers the whole segment with no words lost or repeated", () => {
    const source = spoken(0, 30);
    const lines = captionLines([source]);

    expect(lines.map((l) => l.text).join(" ")).toBe(source.text);
    expect(lines[0].start).toBe(source.start);
    expect(lines[lines.length - 1].end).toBe(source.end);
  });

  it("gives every line real start and end times from its own words", () => {
    const lines = captionLines([spoken(100, 30)]);

    for (const line of lines) {
      const words = line.words ?? [];
      expect(words).not.toHaveLength(0);
      expect(line.start).toBe(words[0].start);
      expect(line.end).toBe(words[words.length - 1].end);
    }
  });

  it("keeps lines in order and non-overlapping, so the active line is findable", () => {
    const lines = captionLines([spoken(0, 30), spoken(30, 25)]);
    for (let i = 1; i < lines.length; i += 1) {
      expect(lines[i].start).toBeGreaterThanOrEqual(lines[i - 1].end - 1e-9);
    }
  });

  it("carries per-word timings onto each line it produces", () => {
    const lines = captionLines([spoken(0, 30)]);
    for (const line of lines) {
      expect(line.words?.length).toBe(line.text.split(" ").length);
    }
  });

  it("breaks where the speaker finished a sentence", () => {
    const segment: TranscriptSegment = {
      start: 0,
      end: 12,
      text: "one two three four. five six seven eight nine ten eleven twelve",
      words: "one two three four. five six seven eight nine ten eleven twelve"
        .split(" ")
        .map((text, i) => ({ start: i, end: i + 1, text })),
    };

    const lines = captionLines([segment]);
    expect(lines[0].text).toBe("one two three four.");
  });

  it("breaks where the speaker paused", () => {
    const words: TranscriptWord[] = [
      { start: 0, end: 1, text: "so" },
      { start: 1, end: 2, text: "here" },
      { start: 2, end: 3, text: "is" },
      { start: 3, end: 4, text: "the" },
      { start: 4, end: 5, text: "thing" },
      // Two seconds of silence — a natural place to end a line.
      { start: 7, end: 8, text: "and" },
      { start: 8, end: 9, text: "then" },
      { start: 9, end: 10, text: "we" },
      { start: 10, end: 11, text: "left" },
    ];
    const lines = captionLines([
      { start: 0, end: 11, text: words.map((w) => w.text).join(" "), words },
    ]);

    expect(lines[0].text).toBe("so here is the thing");
  });

  it("refuses to break a sentence off so short it flickers past", () => {
    // "Yes." is sentence-final after one word; breaking there would leave a
    // row on screen for a fraction of a second.
    const text = "yes. but the rest of this runs on for a good while longer";
    const words = text.split(" ").map((t, i) => ({ start: i, end: i + 1, text: t }));
    const lines = captionLines([{ start: 0, end: words.length, text, words }]);

    expect(lines[0].text.split(" ").length).toBeGreaterThanOrEqual(4);
  });

  it("does not strand a word or two alone on the last row", () => {
    // 10 words: a hard break at 9 would leave one behind.
    const lines = captionLines([spoken(0, 10)]);
    const last = lines[lines.length - 1];
    expect(last.text.split(" ").length).toBeGreaterThanOrEqual(4);
  });

  it("splits a publisher line with no word timings at all", () => {
    const text = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    const lines = captionLines([{ start: 0, end: 40, text }]);

    expect(lines.length).toBeGreaterThan(3);
    expect(lines.map((l) => l.text).join(" ")).toBe(text);
    // Times still run forwards and stay inside the original span.
    expect(lines[0].start).toBeCloseTo(0);
    expect(lines[lines.length - 1].end).toBeCloseTo(40);
  });

  it("passes an empty line through rather than dropping it", () => {
    const blank = { start: 0, end: 30, text: "   " };
    expect(captionLines([blank])).toEqual([blank]);
  });

  it("handles an empty transcript", () => {
    expect(captionLines([])).toEqual([]);
  });
});
