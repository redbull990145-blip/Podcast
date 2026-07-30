import { describe, expect, it } from "vitest";
import { MIN_REMAINING_MS, nudgedMinutes } from "./sleep-timer";

describe("nudgedMinutes", () => {
  const now = 1_700_000_000_000;
  const in15Minutes = now + 15 * 60_000;

  it("adds thirty seconds", () => {
    expect(nudgedMinutes(in15Minutes, now, 30)).toBeCloseTo(15.5);
  });

  it("takes thirty seconds off", () => {
    expect(nudgedMinutes(in15Minutes, now, -30)).toBeCloseTo(14.5);
  });

  it("returns minutes, not a timestamp", () => {
    // The bug this module exists for: handing the deadline back unchanged
    // would return ~1.7e12, which the store reads as minutes from now.
    expect(nudgedMinutes(in15Minutes, now, 0)).toBeLessThan(60);
  });

  it("never drops below the floor, however far it is nudged down", () => {
    const floorMinutes = MIN_REMAINING_MS / 60_000;
    expect(nudgedMinutes(now + 5_000, now, -30)).toBeCloseTo(floorMinutes);
    expect(nudgedMinutes(in15Minutes, now, -100_000)).toBeCloseTo(floorMinutes);
  });

  it("accumulates across repeated presses", () => {
    let deadline = in15Minutes;
    for (let i = 0; i < 3; i += 1) {
      deadline = now + nudgedMinutes(deadline, now, 30) * 60_000;
    }
    expect((deadline - now) / 60_000).toBeCloseTo(16.5);
  });

  it("extends a timer that has just elapsed, from zero rather than from the past", () => {
    // Five seconds overdue plus thirty leaves twenty-five, not thirty.
    expect(nudgedMinutes(now - 5_000, now, 30)).toBeCloseTo(25 / 60);
  });

  it("puts a long-elapsed timer on the floor rather than in the past", () => {
    expect(nudgedMinutes(now - 120_000, now, 30)).toBeCloseTo(
      MIN_REMAINING_MS / 60_000,
    );
  });
});
