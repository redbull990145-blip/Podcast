import { describe, expect, it } from "vitest";
import { STAGES, estimateSeconds, progressAt, stageAt } from "./transcribe-stages";

describe("estimateSeconds", () => {
  it("scales with episode length", () => {
    expect(estimateSeconds(4495)).toBeGreaterThan(estimateSeconds(600));
  });

  it("keeps a floor for very short episodes", () => {
    expect(estimateSeconds(30)).toBeGreaterThanOrEqual(12);
  });

  it("keeps a ceiling so the bar never crawls", () => {
    expect(estimateSeconds(100_000)).toBeLessThanOrEqual(120);
  });

  it("falls back sensibly for an unknown duration", () => {
    expect(estimateSeconds(0)).toBeGreaterThan(0);
    expect(estimateSeconds(Number.NaN)).toBeGreaterThan(0);
  });
});

describe("progressAt", () => {
  it("starts at zero", () => {
    expect(progressAt(0, 60)).toBeCloseTo(0);
  });

  it("increases monotonically", () => {
    let previous = -1;
    for (let t = 0; t <= 120; t += 5) {
      const p = progressAt(t, 60);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });

  it("never claims to be finished, however long it runs", () => {
    // The bar sitting at 100% while the request is still open would be a lie.
    expect(progressAt(10_000, 60)).toBeLessThan(1);
    expect(progressAt(10_000, 60)).toBeLessThanOrEqual(0.97);
  });

  it("keeps creeping past the estimate rather than freezing", () => {
    expect(progressAt(120, 60)).toBeGreaterThan(progressAt(60, 60));
  });
});

describe("stageAt", () => {
  it("names the first stage at the start and the last at the end", () => {
    expect(stageAt(0)).toBe(STAGES[0].label);
    expect(stageAt(1)).toBe(STAGES[STAGES.length - 1].label);
  });

  it("moves through the stages in order as progress grows", () => {
    const seen: string[] = [];
    for (let p = 0; p <= 1; p += 0.02) {
      const label = stageAt(p);
      if (seen[seen.length - 1] !== label) seen.push(label);
    }
    expect(seen).toEqual(STAGES.map((s) => s.label));
  });

  it("always returns a label", () => {
    for (const p of [-1, 0.5, 2]) expect(stageAt(p)).toBeTruthy();
  });
});
