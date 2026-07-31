import { describe, expect, it } from "vitest";
import {
  activeChapterIndex,
  chapterBounds,
  chapterProgress,
  chapterTicks,
  nextChapterStart,
  previousChapterStart,
} from "./chapters";

const CHAPTERS = [
  { startTime: 0, title: "Intro" },
  { startTime: 120, title: "The guest" },
  { startTime: 600, title: "Questions" },
];

describe("activeChapterIndex", () => {
  it("finds the chapter covering a position", () => {
    expect(activeChapterIndex(CHAPTERS, 0)).toBe(0);
    expect(activeChapterIndex(CHAPTERS, 119)).toBe(0);
    expect(activeChapterIndex(CHAPTERS, 120)).toBe(1);
    expect(activeChapterIndex(CHAPTERS, 5_000)).toBe(2);
  });

  it("reports nothing before the first chapter begins", () => {
    // A cold open ahead of the first marker — claiming chapter one there would
    // caption the intro with the wrong title.
    expect(activeChapterIndex([{ startTime: 45, title: "After the open" }], 10)).toBe(-1);
  });

  it("copes with an empty list", () => {
    expect(activeChapterIndex([], 30)).toBe(-1);
  });
});

describe("chapterBounds", () => {
  it("ends a chapter where the next one starts", () => {
    expect(chapterBounds(CHAPTERS, 1, 1_800)).toEqual({ start: 120, end: 600 });
  });

  it("runs the last chapter to the end of the episode", () => {
    expect(chapterBounds(CHAPTERS, 2, 1_800)).toEqual({ start: 600, end: 1_800 });
  });

  it("prefers an explicit endTime when the feed publishes one", () => {
    const withEnd = [{ startTime: 0, endTime: 60, title: "Intro" }, ...CHAPTERS.slice(1)];
    expect(chapterBounds(withEnd, 0, 1_800)).toEqual({ start: 0, end: 60 });
  });

  it("never lets an overlapping endTime run past the next chapter", () => {
    const overlapping = [
      { startTime: 0, endTime: 900, title: "Intro" },
      { startTime: 120, title: "The guest" },
    ];
    expect(chapterBounds(overlapping, 0, 1_800).end).toBe(120);
  });

  it("leaves the last chapter unmeasured while the duration is unknown", () => {
    expect(chapterBounds(CHAPTERS, 2, 0)).toEqual({ start: 600, end: 600 });
  });

  it("is zero for an index that isn't there", () => {
    expect(chapterBounds(CHAPTERS, 9, 1_800)).toEqual({ start: 0, end: 0 });
  });
});

describe("chapterProgress", () => {
  it("measures across the chapter, not the episode", () => {
    // Halfway through chapter 1, which spans 120-600.
    expect(chapterProgress(CHAPTERS, 1, 360, 1_800)).toBeCloseTo(0.5);
  });

  it("clamps outside the chapter", () => {
    expect(chapterProgress(CHAPTERS, 1, 0, 1_800)).toBe(0);
    expect(chapterProgress(CHAPTERS, 1, 5_000, 1_800)).toBe(1);
  });

  it("is 0 rather than NaN when the span isn't known", () => {
    expect(chapterProgress(CHAPTERS, 2, 700, 0)).toBe(0);
  });
});

describe("chapterTicks", () => {
  it("marks each boundary as a fraction of the episode", () => {
    expect(chapterTicks(CHAPTERS, 1_200)).toEqual([0.1, 0.5]);
  });

  it("drops a mark at the very start, which would hide under the track cap", () => {
    expect(chapterTicks([{ startTime: 0, title: "Intro" }], 1_200)).toEqual([]);
  });

  it("drops marks at or past the end", () => {
    const past = [
      { startTime: 600, title: "Fine" },
      { startTime: 1_200, title: "Exactly the end" },
      { startTime: 4_000, title: "Past the end" },
    ];
    expect(chapterTicks(past, 1_200)).toEqual([0.5]);
  });

  it("paints coincident boundaries once", () => {
    const duplicated = [
      { startTime: 300, title: "One" },
      { startTime: 300, title: "Same spot" },
    ];
    expect(chapterTicks(duplicated, 1_200)).toEqual([0.25]);
  });

  it("is empty before the duration is known", () => {
    expect(chapterTicks(CHAPTERS, 0)).toEqual([]);
  });
});

describe("previousChapterStart", () => {
  it("restarts the current chapter when you are into it", () => {
    expect(previousChapterStart(CHAPTERS, 400, 1_800)).toBe(120);
  });

  it("steps back a chapter when you are already at the start of one", () => {
    expect(previousChapterStart(CHAPTERS, 121, 1_800)).toBe(0);
  });

  it("holds at the first chapter rather than going negative", () => {
    expect(previousChapterStart(CHAPTERS, 1, 1_800)).toBe(0);
  });

  it("is null before the first chapter starts", () => {
    expect(previousChapterStart([{ startTime: 45, title: "Late" }], 10, 1_800)).toBeNull();
  });
});

describe("nextChapterStart", () => {
  it("goes to the following chapter", () => {
    expect(nextChapterStart(CHAPTERS, 300)).toBe(600);
  });

  it("goes to the first chapter from before it starts", () => {
    expect(nextChapterStart([{ startTime: 45, title: "Late" }], 10)).toBe(45);
  });

  it("is null in the last chapter, so the control can disable", () => {
    expect(nextChapterStart(CHAPTERS, 900)).toBeNull();
  });
});
