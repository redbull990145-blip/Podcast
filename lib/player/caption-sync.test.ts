import { describe, expect, it } from "vitest";
import {
  MAX_AUTO_OFFSET_SECONDS,
  MAX_NUDGE_SECONDS,
  applyNudge,
  captionOffsetFor,
  inferCaptionOffset,
  inferRecutOffset,
  offsetAt,
  playbackTimeFor,
  resolveAnchors,
  toPlaybackTime,
  toTranscriptTime,
  transcriptEndSeconds,
  transcriptTimeAt,
  type CaptionAnchor,
} from "./caption-sync";

describe("captionOffsetFor", () => {
  it("shifts a publisher transcript by the inserted advertising", () => {
    expect(captionOffsetFor("publisher", 3883, 3838)).toBe(45);
  });

  it("never shifts an AI transcript by the gap to its own last word", () => {
    // The regression the `:v2:` nudge retirement was about. That gap is the
    // outro Whisper correctly declined to transcribe, and reading it as
    // advertising threw every caption seconds late.
    expect(captionOffsetFor("colab/medium", 3851, 3838)).toBe(0);
    expect(captionOffsetFor("groq/whisper-large-v3", 3600, 3400)).toBe(0);
  });

  it("does not shift when the source is unknown", () => {
    expect(captionOffsetFor(null, 3851, 3838)).toBe(0);
  });

  it("is unmoved by a duration the browser guessed wrong mid-file", () => {
    // Resuming into the middle of a VBR MP3 makes `duration` an extrapolation.
    // With nothing recorded about the transcribed audio there is nothing to
    // compare it against, so it must change nothing.
    const at = (guessedDuration: number) =>
      captionOffsetFor("colab/medium", guessedDuration, 3514);
    expect(at(3523)).toBe(0);
    expect(at(3480)).toBe(0);
    expect(at(0)).toBe(0);
  });
});

/**
 * The case the old "an AI transcript was made from this exact file" assumption
 * got wrong: on a host that stitches advertising in at request time, the file we
 * transcribed and the file the listener streams are two different cuts.
 */
describe("captionOffsetFor, for a transcript we generated ourselves", () => {
  it("does not shift when nothing was recorded about the audio", () => {
    // Every transcript made before the length was stored. No evidence is not
    // evidence of no drift, but it is all there is, and guessing is worse.
    expect(captionOffsetFor("colab/medium", 3851, 3838)).toBe(0);
    expect(captionOffsetFor("groq/whisper-large-v3", 3660, 3400, null, null)).toBe(0);
    expect(captionOffsetFor("groq/whisper-large-v3", 3660, 3400, null, 0)).toBe(0);
  });

  it("shifts by the advertising added since it was transcribed", () => {
    // 3600s of audio when it was transcribed, 3660s now: a minute of ads the
    // transcription never heard, sitting in front of the content.
    expect(captionOffsetFor("groq/whisper-large-v3", 3660, 3400, null, 3600)).toBe(60);
  });

  it("shifts the other way when this cut carries less advertising", () => {
    // The direction the publisher path cannot have and this one can — the
    // captions belong to a longer file, so they need pulling earlier.
    expect(captionOffsetFor("groq/whisper-large-v3", 3540, 3400, null, 3600)).toBe(-60);
  });

  it("compares file length to file length, not to the last word", () => {
    // Both numbers describe the whole file including its outro, so a transcript
    // ending 260s before the audio does is ordinary and means nothing.
    expect(captionOffsetFor("groq/whisper-large-v3", 3660, 3400, null, 3660)).toBe(0);
  });

  it("tolerates a browser duration out by less than an ad break", () => {
    // `useSettledDuration` waits for this to stop moving, but a VBR file the
    // listener never fully buffers can settle on an extrapolation. The floor is
    // what stops that becoming a shift.
    const at = (guessed: number) =>
      captionOffsetFor("colab/medium", guessed, 3400, null, 3514);
    expect(at(3514)).toBe(0);
    expect(at(3523)).toBe(0);
    expect(at(3490)).toBe(0);
    expect(at(0)).toBe(0);
  });

  it("refuses a difference too large to be an ad break", () => {
    const tooBig = 10_000 - MAX_AUTO_OFFSET_SECONDS - 1;
    expect(captionOffsetFor("colab/medium", 10_000, 3400, null, tooBig)).toBe(0);
    // Most of the episode: these are not the same recording.
    expect(captionOffsetFor("colab/medium", 1000, 400, null, 400)).toBe(0);
  });
});

describe("inferRecutOffset", () => {
  it("is 0 without a recorded duration to compare against", () => {
    expect(inferRecutOffset(3660, null)).toBe(0);
    expect(inferRecutOffset(3660, undefined)).toBe(0);
  });

  it("is 0 for nonsensical numbers on either side", () => {
    expect(inferRecutOffset(0, 3600)).toBe(0);
    expect(inferRecutOffset(3660, 0)).toBe(0);
    expect(inferRecutOffset(NaN, 3600)).toBe(0);
    expect(inferRecutOffset(Infinity, 3600)).toBe(0);
    expect(inferRecutOffset(3660, NaN)).toBe(0);
  });

  it("rounds to whole seconds, as the nudge control displays them", () => {
    expect(inferRecutOffset(3660.4, 3600)).toBe(60);
    expect(inferRecutOffset(3660.6, 3600)).toBe(61);
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

/**
 * A show with a pre-roll and two mid-rolls, as the corrections would end up
 * after a listener fixed each break where they heard it. Used throughout below
 * because it is the case a single constant cannot express at all.
 */
const STEPPED: CaptionAnchor[] = [
  { at: 0, offset: 30 },
  { at: 1200, offset: 90 },
  { at: 2400, offset: 150 },
];

describe("offsetAt", () => {
  it("takes the last correction at or before the position", () => {
    expect(offsetAt(STEPPED, 0)).toBe(30);
    expect(offsetAt(STEPPED, 1199)).toBe(30);
    expect(offsetAt(STEPPED, 1200)).toBe(90);
    expect(offsetAt(STEPPED, 2399)).toBe(90);
    expect(offsetAt(STEPPED, 2400)).toBe(150);
    expect(offsetAt(STEPPED, 9999)).toBe(150);
  });

  it("is 0 with no corrections at all", () => {
    expect(offsetAt([], 500)).toBe(0);
  });

  it("uses the first correction for anything before it", () => {
    expect(offsetAt([{ at: 600, offset: 30 }], 0)).toBe(30);
  });
});

describe("transcriptTimeAt", () => {
  it("subtracts the shift in force at that moment", () => {
    expect(transcriptTimeAt(STEPPED, 600)).toBe(570);
    expect(transcriptTimeAt(STEPPED, 1300)).toBe(1210);
    expect(transcriptTimeAt(STEPPED, 2500)).toBe(2350);
  });

  it("clamps into the pre-roll rather than going negative", () => {
    expect(transcriptTimeAt(STEPPED, 5)).toBe(0);
  });
});

describe("playbackTimeFor", () => {
  it("round-trips a position clear of any break", () => {
    /*
     * Clear meaning outside the overlaps, which for these corrections are the
     * sixty seconds of transcript either break duplicates — playback 1140–1200
     * and 2340–2400. Everywhere else the map is one-to-one and has to be exact.
     */
    for (const playback of [100, 600, 1100, 1400, 2000, 2500, 3600]) {
      const transcript = transcriptTimeAt(STEPPED, playback);
      expect(playbackTimeFor(STEPPED, transcript)).toBeCloseTo(playback, 6);
    }
  });

  it("seeks past a break for a line inside the overlap", () => {
    /*
     * The first stretch covers transcript [−30, 1170) and the second [1110,
     * 2310), so 1110–1170 belongs to both: those words were on screen once at
     * their wrong position before the break and are correctly reachable after
     * it. Transcript 1150 is inside that, and both 1180 and 1240 are
     * arithmetically valid answers.
     *
     * The later one wins. It is the mapping the listener corrected *to*, so
     * clicking the line lands on the words; seeking back would land in the
     * stretch they had already judged wrong.
     */
    expect(playbackTimeFor(STEPPED, 1150)).toBe(1240);
  });

  it("lands where the transcript resumes for words this cut skipped", () => {
    // A correction that *decreases* leaves a gap rather than an overlap: those
    // words are not in this cut at all. Answer with where they pick up again.
    const shrinking: CaptionAnchor[] = [
      { at: 0, offset: 30 },
      { at: 1200, offset: 10 },
    ];
    expect(playbackTimeFor(shrinking, 1180)).toBe(1200);
  });

  it("is a plain addition when there is only one correction", () => {
    expect(playbackTimeFor([{ at: 0, offset: 13 }], 120)).toBe(133);
    expect(playbackTimeFor([{ at: 0, offset: 13 }], 0)).toBe(13);
  });

  it("never returns a negative position", () => {
    expect(playbackTimeFor([{ at: 0, offset: -60 }], 10)).toBe(0);
    expect(playbackTimeFor([], -5)).toBe(0);
  });
});

describe("resolveAnchors", () => {
  it("is the guess alone when nothing has been corrected", () => {
    expect(resolveAnchors(30, [])).toEqual([{ at: 0, offset: 30 }]);
    expect(resolveAnchors(0, [])).toEqual([{ at: 0, offset: 0 }]);
  });

  it("adds corrections to the guess rather than replacing it", () => {
    // A listener who dialled in +4 against a guess of +30 meant "four more than
    // whatever you worked out", so a better guess must not double the total.
    expect(resolveAnchors(30, [{ at: 0, offset: 4 }])).toEqual([{ at: 0, offset: 34 }]);
  });

  it("leaves the stretch before a mid-episode correction on the guess alone", () => {
    expect(resolveAnchors(30, [{ at: 1200, offset: 60 }])).toEqual([
      { at: 0, offset: 30 },
      { at: 1200, offset: 90 },
    ]);
  });

  it("sorts corrections that arrived out of order", () => {
    const resolved = resolveAnchors(0, [
      { at: 2400, offset: 120 },
      { at: 0, offset: 30 },
      { at: 1200, offset: 60 },
    ]);
    expect(resolved.map((a) => a.at)).toEqual([0, 1200, 2400]);
  });
});

describe("applyNudge", () => {
  it("corrects the whole episode on the first press", () => {
    // Someone who nudges two minutes in means "the captions are late", not
    // "the captions are late from two minutes in".
    expect(applyNudge([], -1, 120)).toEqual([{ at: 0, offset: -1 }]);
  });

  it("gathers repeated presses into one correction", () => {
    /*
     * Ten presses over a few seconds of playback is one decision, not ten —
     * and twenty minutes into the episode, so measuring "is this the same
     * correction" from the anchor at zero would call nine of them new and leave
     * a staircase. `lastPressAt` is what makes it one.
     */
    let anchors = applyNudge([], -1, 1200);
    let last = 1200;
    for (let i = 1; i < 10; i += 1) {
      anchors = applyNudge(anchors, -1, 1200 + i, last);
      last = 1200 + i;
    }
    expect(anchors).toEqual([{ at: 0, offset: -10 }]);
  });

  it("splits when the listener corrects somewhere else later on", () => {
    // The mid-roll flow: right at the start, wrong again after the break.
    const start = applyNudge([], 30, 60);
    const afterBreak = applyNudge(start, 60, 1400, 60);

    expect(afterBreak).toEqual([
      { at: 0, offset: 30 },
      // Starts from the stretch it is splitting, so one press means "sixty more
      // than before" rather than "sixty in total".
      { at: 1400, offset: 90 },
    ]);
  });

  it("keeps a mid-roll correction on its own stretch as it is dialled in", () => {
    // The full flow, end to end: correct the pre-roll, listen on, correct again
    // after the break, and the first stretch must not move.
    let anchors = applyNudge([], 1, 30);
    let last = 30;
    for (let i = 0; i < 29; i += 1) {
      anchors = applyNudge(anchors, 1, 32 + i, last);
      last = 32 + i;
    }
    expect(anchors).toEqual([{ at: 0, offset: 30 }]);

    // Fifteen minutes later, a mid-roll lands and the captions slip again.
    for (let i = 0; i < 60; i += 1) {
      const at = 960 + i;
      anchors = applyNudge(anchors, 1, at, i === 0 ? last : 960 + i - 1);
      last = at;
    }
    expect(anchors).toEqual([
      { at: 0, offset: 30 },
      { at: 960, offset: 90 },
    ]);
  });

  it("keeps adjusting the same correction while the listener stays near it", () => {
    const anchors = applyNudge(
      [
        { at: 0, offset: 30 },
        { at: 1400, offset: 90 },
      ],
      1,
      1440,
    );
    expect(anchors).toEqual([
      { at: 0, offset: 30 },
      { at: 1400, offset: 91 },
    ]);
  });

  it("corrects an earlier stretch when the listener seeks back into it", () => {
    const anchors = applyNudge(
      [
        { at: 0, offset: 30 },
        { at: 1400, offset: 90 },
      ],
      -5,
      600,
    );
    expect(anchors).toEqual([
      { at: 0, offset: 30 },
      { at: 600, offset: 25 },
      { at: 1400, offset: 90 },
    ]);
  });

  it("clamps a correction that has run away", () => {
    let anchors = applyNudge([], 0, 0);
    for (let i = 0; i < MAX_NUDGE_SECONDS + 40; i += 1) {
      anchors = applyNudge(anchors, 1, 0);
    }
    expect(anchors[0].offset).toBe(MAX_NUDGE_SECONDS);
  });

  it("stops adding steps rather than growing without bound", () => {
    let anchors: CaptionAnchor[] = [];
    // Each press far enough from the last to split, twenty times over.
    for (let i = 0; i < 20; i += 1) {
      anchors = applyNudge(anchors, 1, i * 600);
    }
    expect(anchors.length).toBeLessThanOrEqual(16);
    // Still responding — the last press adjusted a stretch instead of adding one.
    expect(anchors[anchors.length - 1].offset).toBeGreaterThan(1);
  });

  it("rounds positions to whole seconds, as the anchors are displayed", () => {
    expect(applyNudge([{ at: 0, offset: 5 }], 1, 1400.7)).toEqual([
      { at: 0, offset: 5 },
      { at: 1401, offset: 6 },
    ]);
  });
});
