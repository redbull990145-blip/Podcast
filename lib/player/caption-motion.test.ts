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
