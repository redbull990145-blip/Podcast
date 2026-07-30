import { describe, expect, it } from "vitest";
import {
  MAX_AUTO_OFFSET_SECONDS,
  inferCaptionOffset,
  toPlaybackTime,
  toTranscriptTime,
  transcriptEndSeconds,
} from "./caption-sync";

describe("inferCaptionOffset", () => {
  it("reads the gap as inserted advertising", () => {
    // The real case: a 3838s transcript against a 3851s served file.
    expect(inferCaptionOffset(3851, 3838)).toBe(13);
  });

  it("ignores a gap small enough to be rounding", () => {
    expect(inferCaptionOffset(3840, 3838)).toBe(0);
    expect(inferCaptionOffset(3841, 3838)).toBe(0);
  });

  it("takes a gap just past the noise floor", () => {
    expect(inferCaptionOffset(3842, 3838)).toBe(4);
  });

  it("refuses when the transcript is longer than the audio", () => {
    // Means the transcript is for a different cut, not that ads were added.
    expect(inferCaptionOffset(3000, 3838)).toBe(0);
  });

  it("refuses an implausibly large gap", () => {
    expect(inferCaptionOffset(10_000, 10_000 - MAX_AUTO_OFFSET_SECONDS - 1)).toBe(0);
  });

  it("refuses when the gap is most of the episode", () => {
    expect(inferCaptionOffset(1000, 400)).toBe(0);
  });

  it("returns 0 for missing or nonsensical durations", () => {
    expect(inferCaptionOffset(0, 3838)).toBe(0);
    expect(inferCaptionOffset(3851, 0)).toBe(0);
    expect(inferCaptionOffset(NaN, 3838)).toBe(0);
    expect(inferCaptionOffset(Infinity, 3838)).toBe(0);
  });

  it("is 0 for an AI transcript, which was made from the served audio", () => {
    // Same file in and out, so the span already matches bar a rounding second.
    expect(inferCaptionOffset(3851, 3850.4)).toBe(0);
  });
});

describe("transcriptEndSeconds", () => {
  it("takes the end of the last segment", () => {
    expect(transcriptEndSeconds([{ end: 10 }, { end: 25.5 }])).toBe(25.5);
  });

  it("is 0 for an empty transcript", () => {
    expect(transcriptEndSeconds([])).toBe(0);
  });
});

describe("time mapping", () => {
  it("round-trips a position through both directions", () => {
    expect(toPlaybackTime(toTranscriptTime(100, 13), 13)).toBe(100);
  });

  it("clamps into the pre-roll rather than going negative", () => {
    // Inside the inserted ad there is no transcript yet; pin to the start.
    expect(toTranscriptTime(5, 13)).toBe(0);
  });

  it("seeks past the pre-roll when a line is clicked", () => {
    expect(toPlaybackTime(0, 13)).toBe(13);
    expect(toPlaybackTime(120, 13)).toBe(133);
  });

  it("is a no-op with no offset", () => {
    expect(toTranscriptTime(100, 0)).toBe(100);
    expect(toPlaybackTime(100, 0)).toBe(100);
  });
});
