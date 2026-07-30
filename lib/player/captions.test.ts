import { describe, expect, it } from "vitest";
import { activeSegmentIndex } from "./captions";

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
