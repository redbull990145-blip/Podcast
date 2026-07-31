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
    expect(captionOffsetFor("publisher", 3883, 3838)).toBe(45);
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
  it("reads a gap the size of an ad break as inserted advertising", () => {
    expect(inferCaptionOffset(3883, 3838)).toBe(45);
  });

  it("ignores a gap small enough to be rounding", () => {
    expect(inferCaptionOffset(3840, 3838)).toBe(0);
    expect(inferCaptionOffset(3841, 3838)).toBe(0);
  });

  it("leaves an episode's own outro alone", () => {
    // Measured from Elevation with Steven Furtick: the served file runs 8.73s
    // past the length the feed declares, and decoding it shows every one of
    // those seconds is silence and a sting *after* the last word. Reading them
    // as pre-roll shifted the whole transcript nine seconds late.
    expect(inferCaptionOffset(3523.21, 3514)).toBe(0);
    expect(inferCaptionOffset(3108.57, 3100)).toBe(0);
  });

  it("takes a gap just past the noise floor", () => {
    expect(inferCaptionOffset(3869, 3838)).toBe(31);
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

describe("captionOffsetFor, measuring against the feed's own duration", () => {
  it("prefers the feed's length to the transcript's last word", () => {
    // The transcript stops at the last word and the feed counts the outro too,
    // so the two disagree by however long the ending runs. Only the feed's
    // number isolates what the host actually inserted.
    const ads = captionOffsetFor("publisher", 3900, 3500, 3838);
    expect(ads).toBe(62);
  });

  it("falls back to the transcript when a feed omits its duration", () => {
    expect(captionOffsetFor("publisher", 3900, 3838, null)).toBe(62);
    expect(captionOffsetFor("publisher", 3900, 3838, undefined)).toBe(62);
    // A zero is a missing value, not a zero-length episode.
    expect(captionOffsetFor("publisher", 3900, 3838, 0)).toBe(62);
  });

  it("leaves the Elevation episodes unshifted", () => {
    // The bug this was written for: nine seconds of lag on every caption.
    expect(captionOffsetFor("publisher", 3523.21, 3514.48, 3514)).toBe(0);
    expect(captionOffsetFor("publisher", 3108.57, 3099.84, 3100)).toBe(0);
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
