import { describe, expect, it } from "vitest";
import {
  calibrateSecondsPerByte,
  formatResetWindow,
  mergeSegments,
  planChunks,
  rateLimitMessage,
} from "./transcribe";

describe("planChunks", () => {
  it("returns a single range when the file fits in one chunk", () => {
    expect(planChunks(1000, 4096)).toEqual([{ start: 0, end: 1000 }]);
  });

  it("splits into contiguous, non-overlapping ranges", () => {
    expect(planChunks(1000, 400)).toEqual([
      { start: 0, end: 400 },
      { start: 400, end: 800 },
      { start: 800, end: 1000 },
    ]);
  });

  it("covers the whole file exactly, with the last chunk shorter", () => {
    const ranges = planChunks(950, 300);
    expect(ranges[0].start).toBe(0);
    expect(ranges[ranges.length - 1].end).toBe(950);
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i].start).toBe(ranges[i - 1].end);
    }
  });

  it("handles an exact multiple with no empty trailing chunk", () => {
    expect(planChunks(800, 400)).toEqual([
      { start: 0, end: 400 },
      { start: 400, end: 800 },
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(planChunks(0, 400)).toEqual([]);
  });
});

describe("calibrateSecondsPerByte", () => {
  it("uses the feed duration when it is available", () => {
    // 3600s over 60MB => 6e-5 s/byte.
    expect(calibrateSecondsPerByte({ total: 60_000_000, durationSeconds: 3600 })).toBeCloseTo(
      3600 / 60_000_000,
    );
  });

  it("falls back to the first chunk's measured rate when no duration", () => {
    const rate = calibrateSecondsPerByte({
      total: 60_000_000,
      durationSeconds: null,
      firstChunkBytes: 20_000_000,
      firstChunkDuration: 1200,
    });
    expect(rate).toBeCloseTo(1200 / 20_000_000);
  });

  it("prefers a valid feed duration over first-chunk calibration", () => {
    const rate = calibrateSecondsPerByte({
      total: 60_000_000,
      durationSeconds: 3600,
      firstChunkBytes: 20_000_000,
      firstChunkDuration: 999, // deliberately wrong; must be ignored
    });
    expect(rate).toBeCloseTo(3600 / 60_000_000);
  });

  it("falls back to a nominal bitrate when nothing else is known", () => {
    const rate = calibrateSecondsPerByte({ total: 60_000_000 });
    expect(rate).toBeCloseTo(1 / 16_000);
  });

  it("ignores a zero or negative duration", () => {
    const rate = calibrateSecondsPerByte({ total: 100, durationSeconds: 0 });
    expect(rate).toBeCloseTo(1 / 16_000);
  });
});

describe("mergeSegments", () => {
  it("offsets each chunk's timings by its byte position", () => {
    // 1 second per 1000 bytes.
    const merged = mergeSegments(
      [
        { startByte: 0, byteLength: 1000, segments: [{ start: 0, end: 2, text: "one" }] },
        { startByte: 1000, byteLength: 1000, segments: [{ start: 0, end: 2, text: "two" }] },
      ],
      1 / 1000,
    );

    expect(merged).toEqual([
      { start: 0, end: 2, text: "one" },
      { start: 1, end: 3, text: "two" },
    ]);
  });

  it("orders segments across chunks by their global start", () => {
    const merged = mergeSegments(
      [
        { startByte: 2000, byteLength: 1000, segments: [{ start: 0, end: 1, text: "late" }] },
        { startByte: 0, byteLength: 1000, segments: [{ start: 0, end: 1, text: "early" }] },
      ],
      1 / 1000,
    );

    expect(merged.map((s) => s.text)).toEqual(["early", "late"]);
  });

  it("drops a duplicate line produced by an overlap at a cut point", () => {
    const merged = mergeSegments(
      [
        { startByte: 0, byteLength: 1000, segments: [{ start: 0.9, end: 1, text: "boundary" }] },
        { startByte: 1000, byteLength: 1000, segments: [{ start: 0, end: 0.2, text: "boundary" }] },
      ],
      1 / 1000,
    );

    // Both land near t=1.0s with identical text; only one should survive.
    expect(merged.filter((s) => s.text === "boundary")).toHaveLength(1);
  });

  it("keeps repeated words that are genuinely far apart", () => {
    const merged = mergeSegments(
      [
        { startByte: 0, byteLength: 1000, segments: [{ start: 0, end: 1, text: "yeah" }] },
        { startByte: 5000, byteLength: 1000, segments: [{ start: 0, end: 1, text: "yeah" }] },
      ],
      1 / 1000,
    );

    expect(merged.filter((s) => s.text === "yeah")).toHaveLength(2);
  });

  it("skips blank segments", () => {
    const merged = mergeSegments(
      [{ startByte: 0, byteLength: 1000, segments: [{ start: 0, end: 1, text: "   " }] }],
      1 / 1000,
    );
    expect(merged).toEqual([]);
  });
});

describe("formatResetWindow", () => {
  it("reads Groq's compact minutes-and-seconds format", () => {
    expect(formatResetWindow("59m20s")).toBe("59 minutes");
    expect(formatResetWindow("12m30s")).toBe("13 minutes");
  });

  it("rounds to hours only once past a full hour", () => {
    expect(formatResetWindow("60m")).toBe("an hour");
    expect(formatResetWindow("150m")).toBe("3 hours");
  });

  it("reads a bare seconds value from Retry-After", () => {
    expect(formatResetWindow("30")).toBe("30 seconds");
  });

  it("reads a fractional seconds-only value", () => {
    expect(formatResetWindow("43.2s")).toBe("44 seconds");
  });

  it("switches to minutes past a minute and a half", () => {
    expect(formatResetWindow("120")).toBe("2 minutes");
  });

  it("returns null for missing or nonsense input", () => {
    expect(formatResetWindow(null)).toBeNull();
    expect(formatResetWindow("soon")).toBeNull();
    expect(formatResetWindow("0")).toBeNull();
  });
});

describe("rateLimitMessage", () => {
  const headersOf = (map: Record<string, string>) => ({
    headers: { get: (name: string) => map[name] ?? null },
  });

  it("tells the user how long the shared allowance takes to free up", () => {
    const message = rateLimitMessage(
      headersOf({ "x-ratelimit-reset-audio-seconds": "59m20s" }),
    );
    expect(message).toContain("59 minutes");
    expect(message).toContain("own Groq or OpenAI key");
  });

  it("falls back to Retry-After", () => {
    expect(rateLimitMessage(headersOf({ "retry-after": "45" }))).toContain("45 seconds");
  });

  it("stays useful when no reset header is present", () => {
    const message = rateLimitMessage(headersOf({}));
    expect(message).toContain("used up for now");
    expect(message).not.toContain("about");
  });
});
