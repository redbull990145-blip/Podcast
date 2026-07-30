import { describe, expect, it } from "vitest";
import { matchesFilter } from "./filters";

describe("matchesFilter", () => {
  const fresh = undefined;
  const barelyStarted = { positionSeconds: 8, played: false };
  const started = { positionSeconds: 400, played: false };
  const finished = { positionSeconds: 3200, played: true };

  it("shows everything under 'all'", () => {
    for (const progress of [fresh, barelyStarted, started, finished]) {
      expect(matchesFilter("all", progress)).toBe(true);
    }
  });

  it("counts a never-opened episode as unplayed", () => {
    expect(matchesFilter("unplayed", fresh)).toBe(true);
  });

  it("still counts an accidental few seconds as unplayed", () => {
    // An episode tapped by mistake should not migrate into "in progress" and
    // quietly disappear from the unplayed list.
    expect(matchesFilter("unplayed", barelyStarted)).toBe(true);
    expect(matchesFilter("in_progress", barelyStarted)).toBe(false);
  });

  it("treats real progress as in progress, and only that", () => {
    expect(matchesFilter("in_progress", started)).toBe(true);
    expect(matchesFilter("unplayed", started)).toBe(false);
    expect(matchesFilter("played", started)).toBe(false);
  });

  it("treats a finished episode as played even with a stored position", () => {
    expect(matchesFilter("played", finished)).toBe(true);
    expect(matchesFilter("in_progress", finished)).toBe(false);
    expect(matchesFilter("unplayed", finished)).toBe(false);
  });

  it("puts every episode in exactly one bucket", () => {
    for (const progress of [fresh, barelyStarted, started, finished]) {
      const matched = (["unplayed", "in_progress", "played"] as const).filter((f) =>
        matchesFilter(f, progress),
      );
      expect(matched).toHaveLength(1);
    }
  });
});
