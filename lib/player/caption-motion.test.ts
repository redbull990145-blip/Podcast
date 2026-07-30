import { describe, expect, it } from "vitest";
import {
  EMPHASIS_RANGE,
  centreOffset,
  clampOffset,
  fillFraction,
  isRowVisible,
  lineEmphasis,
} from "./caption-motion";

describe("lineEmphasis", () => {
  it("gives the spoken line full weight", () => {
    expect(lineEmphasis(5, 5)).toEqual({ opacity: 1, scale: 1, blur: 0 });
  });

  it("dims a line just read exactly as much as one about to be read", () => {
    expect(lineEmphasis(4, 5)).toEqual(lineEmphasis(6, 5));
  });

  it("dims and blurs progressively with distance", () => {
    const near = lineEmphasis(6, 5);
    const far = lineEmphasis(7, 5);
    expect(far.opacity).toBeLessThan(near.opacity);
    expect(far.scale).toBeLessThan(near.scale);
    expect(far.blur).toBeGreaterThan(near.blur);
  });

  it("stops changing past the emphasis range, so distant rows never re-animate", () => {
    const floor = lineEmphasis(5 + EMPHASIS_RANGE, 5);
    expect(lineEmphasis(5 + EMPHASIS_RANGE + 1, 5)).toEqual(floor);
    expect(lineEmphasis(900, 5)).toEqual(floor);
  });

  it("keeps scaling subtle enough not to read as layout movement", () => {
    expect(lineEmphasis(900, 5).scale).toBeGreaterThanOrEqual(0.94);
  });

  it("puts every line at the floor before anything is spoken", () => {
    expect(lineEmphasis(0, -1)).toEqual(lineEmphasis(500, -1));
  });
});

describe("fillFraction", () => {
  const segment = { start: 10, end: 14 };

  it("is empty before the line starts", () => {
    expect(fillFraction(segment, 9.9)).toBe(0);
    expect(fillFraction(segment, 10)).toBe(0);
  });

  it("interpolates across the segment", () => {
    expect(fillFraction(segment, 11)).toBeCloseTo(0.25);
    expect(fillFraction(segment, 12)).toBeCloseTo(0.5);
  });

  it("is full at the end and stays there", () => {
    expect(fillFraction(segment, 14)).toBe(1);
    expect(fillFraction(segment, 400)).toBe(1);
  });

  it("fills instantly for a zero-length segment rather than dividing by zero", () => {
    expect(fillFraction({ start: 10, end: 10 }, 10.5)).toBe(1);
    expect(fillFraction({ start: 10, end: 10 }, 9)).toBe(0);
  });

  it("survives a reversed segment from a malformed transcript", () => {
    expect(fillFraction({ start: 10, end: 4 }, 11)).toBe(1);
  });
});

describe("fillFraction (word-level)", () => {
  // Two words of equal length, each +1 trailing space => each owns half the line.
  // "hello" (0-1) ... gap ... "world" (2-3).
  const words = [
    { start: 0, end: 1, text: "hello" },
    { start: 2, end: 3, text: "world" },
  ];
  const segment = { start: 0, end: 4, words };

  it("sits at the leading edge of the first word as it begins", () => {
    // Each word+space is 6 chars of 12 total, so "hello" owns the first 0.5.
    expect(fillFraction(segment, 0)).toBeCloseTo(0);
  });

  it("eases across the first word's character slice while it is spoken", () => {
    // Halfway through "hello": half of its 0.5 slice => 0.25.
    expect(fillFraction(segment, 0.5)).toBeCloseTo(0.25);
    // End of "hello": its whole slice => 0.5.
    expect(fillFraction(segment, 1)).toBeCloseTo(0.5);
  });

  it("HOLDS during the gap between words instead of racing ahead", () => {
    // Between t=1 (end of "hello") and t=2 (start of "world") no word is being
    // spoken, so the fill must stay pinned at 0.5 — the crux of the fix.
    expect(fillFraction(segment, 1.2)).toBeCloseTo(0.5);
    expect(fillFraction(segment, 1.999)).toBeCloseTo(0.5);
  });

  it("steps to the next word's slice only when that word starts", () => {
    // "world" begins at t=2; immediately it has spoken none of its own slice,
    // so the fill is still at 0.5 (end of "hello").
    expect(fillFraction(segment, 2)).toBeCloseTo(0.5);
    // Halfway through "world": 0.5 + half of its 0.5 slice => 0.75.
    expect(fillFraction(segment, 2.5)).toBeCloseTo(0.75);
    // End of "world": full line => 1.
    expect(fillFraction(segment, 3)).toBeCloseTo(1);
  });

  it("is full and stays full after the last word ends", () => {
    expect(fillFraction(segment, 3.5)).toBe(1);
    expect(fillFraction(segment, 999)).toBe(1);
  });

  it("is empty before the segment starts, even with words present", () => {
    const early = { start: 10, end: 20, words: [{ start: 10, end: 11, text: "hi" }] };
    expect(fillFraction(early, 9)).toBe(0);
    expect(fillFraction(early, 10)).toBe(0);
  });

  it("treats an instantaneous word as fully spoken once it starts", () => {
    const seg = {
      start: 0,
      end: 2,
      words: [
        { start: 0, end: 0, text: "boom" },
        { start: 1, end: 2, text: "ok" },
      ],
    };
    // "boom" (4 chars + space = 5) / 8 total = 0.625, spoken in full once reached.
    expect(fillFraction(seg, 0.5)).toBeCloseTo(5 / 8);
  });
});

describe("centreOffset", () => {
  // Ten 100px rows in a 300px viewport: 1000px of content, 700px of travel.
  const tops = Array.from({ length: 10 }, (_, i) => i * 100);
  const total = 1000;

  it("centres a mid-list row", () => {
    // Row 5 starts at 500; centring a 100px row in 300px puts the top at 400.
    expect(centreOffset(tops, total, 5, 300, 100)).toBe(-400);
  });

  it("never scrolls above the first line", () => {
    expect(centreOffset(tops, total, 0, 300, 100)).toBe(0);
    expect(centreOffset(tops, total, 1, 300, 100)).toBe(0);
  });

  it("never scrolls past the last line", () => {
    expect(centreOffset(tops, total, 9, 300, 100)).toBe(-700);
  });

  it("stays put when the content is shorter than the viewport", () => {
    expect(centreOffset([0, 100], 200, 1, 800, 100)).toBe(0);
  });

  it("treats an unknown index as the top", () => {
    expect(centreOffset(tops, total, 99, 300, 100)).toBe(0);
  });
});

describe("clampOffset", () => {
  it("refuses to drag past either end", () => {
    expect(clampOffset(200, 1000, 300)).toBe(0);
    expect(clampOffset(-9000, 1000, 300)).toBe(-700);
  });

  it("passes through a value already in range", () => {
    expect(clampOffset(-250, 1000, 300)).toBe(-250);
  });

  it("pins a short transcript to the top", () => {
    expect(clampOffset(-50, 200, 800)).toBe(0);
  });
});

describe("isRowVisible", () => {
  const tops = Array.from({ length: 10 }, (_, i) => i * 100);

  it("sees a row inside the window", () => {
    expect(isRowVisible(tops, 5, -400, 300)).toBe(true);
  });

  it("does not see a row scrolled well past", () => {
    expect(isRowVisible(tops, 0, -900, 300)).toBe(false);
  });

  it("does not see a row far below the fold", () => {
    expect(isRowVisible(tops, 9, 0, 300)).toBe(false);
  });

  it("allows a little slack above, so a part-scrolled line still counts", () => {
    // Row 4 top is 400, viewport starts at 420 — 20px clipped is still "in view".
    expect(isRowVisible(tops, 4, -420, 300)).toBe(true);
  });

  it("reports an unknown index as not visible", () => {
    expect(isRowVisible(tops, 99, 0, 300)).toBe(false);
  });
});
