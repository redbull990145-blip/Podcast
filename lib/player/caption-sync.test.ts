import { describe, expect, it } from "vitest";
import {
  MAX_AUTO_OFFSET_SECONDS,
  captionOffsetFor,
  inferCaptionOffset,
  toPlaybackTime,
  toTranscriptTime,
  transcriptEndSeconds,
} from "./caption-sync";

describe("captionOffsetFor", () => {
  it("shifts a publisher transcript by the inserted advertising", () => {
    expect(captionOffsetFor("publisher", 3851, 3838)).toBe(13);
  });

  it("never shifts an AI transcript, whatever the gap", () => {
    // Whisper transcribed this exact file, so the timings are already right.
    // The gap is the outro it correctly declined to transcribe.
    expect(captionOffsetFor("colab/medium", 3851, 3838)).toBe(0);
    expect(captionOffsetFor("groq/whisper-large-v3", 3600, 3400)).toBe(0);
  });

  it("does not shift when the source is unknown", () => {
    expect(captionOffsetFor(null, 3851, 3838)).toBe(0);
  });

  it("is unmoved by a duration the browser guessed wrong mid-file", () => {
    // Resuming into the middle of a VBR MP3 makes `duration` an extrapolation.
    // For an AI transcript that must change nothing — which is the whole point.
    const at = (guessedDuration: number) =>
      captionOffsetFor("colab/medium", guessedDuration, 3514);
    expect(at(3523)).toBe(0);
    expect(at(3480)).toBe(0);
    expect(at(0)).toBe(0);
  });
});

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
