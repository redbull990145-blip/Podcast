import { describe, expect, it } from "vitest";
import { centreOn, measureRows, rowAt, visibleRange } from "./virtual-list";

describe("measureRows", () => {
  it("stacks rows with the gap between them", () => {
    expect(measureRows([10, 20, 30], 2)).toEqual({ tops: [0, 12, 34], total: 64 });
  });

  it("adds no trailing gap to the total", () => {
    // 10 + 2 + 10 = 22, not 24: the gap sits between rows, not after the last.
    expect(measureRows([10, 10], 2).total).toBe(22);
  });

  it("handles an empty transcript", () => {
    expect(measureRows([], 2)).toEqual({ tops: [], total: 0 });
  });

  it("handles a single row", () => {
    expect(measureRows([40], 2)).toEqual({ tops: [0], total: 40 });
  });
});

describe("rowAt", () => {
  const tops = measureRows(Array(100).fill(10), 0).tops;

  it("finds the row containing a position", () => {
    expect(rowAt(tops, 0)).toBe(0);
    expect(rowAt(tops, 55)).toBe(5);
    expect(rowAt(tops, 59)).toBe(5);
  });

  it("treats an exact boundary as the start of that row", () => {
    expect(rowAt(tops, 60)).toBe(6);
  });

  it("clamps above and below the list", () => {
    expect(rowAt(tops, -100)).toBe(0);
    expect(rowAt(tops, 999999)).toBe(99);
  });

  it("returns 0 for an empty list rather than -1", () => {
    expect(rowAt([], 50)).toBe(0);
  });

  it("agrees with a linear scan on uneven rows", () => {
    const uneven = measureRows([5, 40, 7, 100, 12, 3], 2).tops;
    for (let y = 0; y < 200; y += 1) {
      let expected = 0;
      for (let i = 0; i < uneven.length; i += 1) if (uneven[i] <= y) expected = i;
      expect(rowAt(uneven, y)).toBe(expected);
    }
  });
});

describe("visibleRange", () => {
  const metrics = measureRows(Array(1000).fill(20), 0);

  it("covers the viewport", () => {
    const { start, end } = visibleRange(metrics, 1000, 400, 0);
    // Rows 50..70 are on screen at scrollTop 1000 with a 400px viewport.
    expect(start).toBe(50);
    expect(end).toBe(71);
  });

  it("adds overscan on both sides", () => {
    const { start, end } = visibleRange(metrics, 1000, 400, 5);
    expect(start).toBe(45);
    expect(end).toBe(76);
  });

  it("never runs past either end of the list", () => {
    expect(visibleRange(metrics, 0, 400, 10).start).toBe(0);
    expect(visibleRange(metrics, 19_600, 400, 10).end).toBe(1000);
  });

  it("returns an empty range for an empty transcript", () => {
    expect(visibleRange({ tops: [], total: 0 }, 0, 400)).toEqual({ start: 0, end: 0 });
  });

  it("always includes the row at the top of the viewport", () => {
    for (const scrollTop of [0, 137, 4021, 19_000]) {
      const { start, end } = visibleRange(metrics, scrollTop, 400, 3);
      const first = rowAt(metrics.tops, scrollTop);
      expect(start).toBeLessThanOrEqual(first);
      expect(end).toBeGreaterThan(first);
    }
  });
});

describe("centreOn", () => {
  const metrics = measureRows(Array(500).fill(20), 0);

  it("centres a row in the viewport", () => {
    // Row 100 starts at 2000; centring it in a 400px viewport puts it at 1810.
    expect(centreOn(metrics, 100, 400, 20)).toBe(1810);
  });

  it("does not scroll above the top of the list", () => {
    expect(centreOn(metrics, 0, 400, 20)).toBe(0);
  });

  it("does not scroll past the bottom", () => {
    const max = metrics.total - 400;
    expect(centreOn(metrics, 499, 400, 20)).toBe(max);
  });

  it("stays at zero when the list is shorter than the viewport", () => {
    const short = measureRows([20, 20], 0);
    expect(centreOn(short, 1, 400, 20)).toBe(0);
  });

  it("tolerates an out-of-range index", () => {
    expect(Number.isFinite(centreOn(metrics, 9999, 400, 20))).toBe(true);
  });
});
