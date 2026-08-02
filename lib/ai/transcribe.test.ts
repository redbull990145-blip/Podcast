import { describe, expect, it } from "vitest";
import {
  chunkDuration,
  detectAudioKind,
  formatResetWindow,
  mergeSegments,
  planChunks,
  rateLimitMessage,
  timelineCoversAudio,
} from "./transcribe";
import { frameSeconds, prepareChunk } from "./mp3";

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

describe("chunkDuration", () => {
  it("is the end of the latest word, preferring the finer clock", () => {
    const chunk = {
      segments: [{ start: 0, end: 5, text: "a" }],
      words: [
        { start: 0, end: 1, text: "a" },
        { start: 1, end: 6, text: "b" },
      ],
    };
    expect(chunkDuration(chunk)).toBe(6);
  });

  it("falls back to segments when there are no words", () => {
    const chunk = {
      segments: [
        { start: 0, end: 3, text: "one" },
        { start: 3, end: 9, text: "two" },
      ],
      words: [],
    };
    expect(chunkDuration(chunk)).toBe(9);
  });

  it("is 0 for an empty chunk rather than -Infinity", () => {
    expect(chunkDuration({ segments: [], words: [] })).toBe(0);
  });
});

describe("mergeSegments", () => {
  it("offsets each chunk by the measured durations of the chunks before it", () => {
    // Two chunks: the first measures 2s, so the second starts at t=2 — regardless
    // of byte position or bitrate, which is what kills the old drift.
    const merged = mergeSegments([
      {
        segments: [{ start: 0, end: 2, text: "one" }],
        words: [
          { start: 0, end: 1, text: "on" },
          { start: 1, end: 2, text: "e" },
        ],
      },
      {
        segments: [{ start: 0, end: 2, text: "two" }],
        words: [
          { start: 0, end: 1, text: "tw" },
          { start: 1, end: 2, text: "o" },
        ],
      },
    ]);

    expect(merged.map((s) => ({ start: s.start, end: s.end, text: s.text }))).toEqual([
      { start: 0, end: 2, text: "one" },
      { start: 2, end: 4, text: "two" },
    ]);
    // Word timings are offset onto the global timeline too.
    expect(merged[0].words).toEqual([
      { start: 0, end: 1, text: "on" },
      { start: 1, end: 2, text: "e" },
    ]);
    expect(merged[1].words).toEqual([
      { start: 2, end: 3, text: "tw" },
      { start: 3, end: 4, text: "o" },
    ]);
  });

  it("prefers the measured audio duration over where speech stopped", () => {
    // The drift bug. Chunk 0 holds 10s of audio but the speaker stops at 2s and
    // the rest is a music bed, so the transcript alone says "2 seconds" and
    // places chunk 1 eight seconds early.
    const merged = mergeSegments([
      { segments: [{ start: 0, end: 2, text: "one" }], words: [], seconds: 10 },
      { segments: [{ start: 0, end: 2, text: "two" }], words: [], seconds: 10 },
    ]);

    expect(merged.map((s) => s.start)).toEqual([0, 10]);
  });

  it("does not let the error accumulate across many boundaries", () => {
    // Same shape, nine chunks — a three-hour episode. Without measured
    // durations each boundary loses 8s and the last chunk lands 64s early.
    const chunks = Array.from({ length: 9 }, (_, i) => ({
      segments: [{ start: 0, end: 2, text: `line ${i}` }],
      words: [],
      seconds: 10,
    }));

    expect(mergeSegments(chunks).map((s) => s.start)).toEqual([
      0, 10, 20, 30, 40, 50, 60, 70, 80,
    ]);
  });

  it("falls back to the transcript when the container could not be measured", () => {
    // Unparseable audio still has to produce a timeline; a small accumulating
    // error beats stacking every chunk at zero.
    const merged = mergeSegments([
      { segments: [{ start: 0, end: 2, text: "one" }], words: [], seconds: null },
      { segments: [{ start: 0, end: 2, text: "two" }], words: [], seconds: null },
    ]);

    expect(merged.map((s) => s.start)).toEqual([0, 2]);
  });

  it("places each chunk purely by how long the ones before it measured", () => {
    // Two chunks of one second each, whatever their byte sizes were — position
    // on the timeline is a function of duration alone.
    const merged = mergeSegments([
      { segments: [{ start: 0, end: 1, text: "a" }], words: [] },
      { segments: [{ start: 0, end: 1, text: "b" }], words: [] },
    ]);
    expect(merged.map((s) => s.start)).toEqual([0, 1]);
  });

  it("orders segments across chunks by their global start time", () => {
    // Three chunks processed in array order. Chunk 0 measures 3s, chunk 1
    // measures 1s (starts at 3), chunk 2 measures 2s (starts at 4).  After
    // sorting by global start the order is chunk 0, 1, 2 — which happens to be
    // the same as array order here because durations are monotonically placed.
    const merged = mergeSegments([
      { segments: [{ start: 0, end: 3, text: "alpha" }], words: [] },
      { segments: [{ start: 0, end: 1, text: "beta" }], words: [] },
      { segments: [{ start: 0, end: 2, text: "gamma" }], words: [] },
    ]);

    expect(merged.map((s) => ({ text: s.text, start: s.start }))).toEqual([
      { text: "alpha", start: 0 },
      { text: "beta", start: 3 },
      { text: "gamma", start: 4 },
    ]);
  });

  it("drops a duplicate line produced by an overlap at a cut point", () => {
    const merged = mergeSegments([
      {
        segments: [{ start: 0.9, end: 1, text: "boundary" }],
        words: [],
      },
      {
        segments: [{ start: 0, end: 0.2, text: "boundary" }],
        words: [],
      },
    ]);

    // Both land near t=1.0s with identical text; only one should survive.
    expect(merged.filter((s) => s.text === "boundary")).toHaveLength(1);
  });

  it("keeps repeated words that are genuinely far apart", () => {
    // The first chunk measures 3s of audio, so the second "yeah" starts at t=3
    // — well past the 1.5s near-duplicate threshold.
    const merged = mergeSegments([
      { segments: [{ start: 0, end: 3, text: "yeah" }], words: [] },
      {
        segments: [{ start: 0, end: 1, text: "yeah" }],
        words: [],
      },
    ]);

    expect(merged.filter((s) => s.text === "yeah")).toHaveLength(2);
  });

  it("skips blank segments", () => {
    const merged = mergeSegments([
      { segments: [{ start: 0, end: 1, text: "   " }], words: [] },
    ]);
    expect(merged).toEqual([]);
  });

  it("attaches words to the segment whose span they start in", () => {
    const merged = mergeSegments([
      {
        segments: [
          { start: 0, end: 2, text: "first part" },
          { start: 2, end: 4, text: "second part" },
        ],
        words: [
          { start: 0, end: 1, text: "first" },
          { start: 1, end: 2, text: "part" },
          { start: 2, end: 3, text: "second" },
          { start: 3, end: 4, text: "part" },
        ],
      },
    ]);

    expect(merged[0].words?.map((w) => w.text)).toEqual(["first", "part"]);
    expect(merged[1].words?.map((w) => w.text)).toEqual(["second", "part"]);
  });

  it("omits the words field when a chunk carried none", () => {
    const merged = mergeSegments([
      { segments: [{ start: 0, end: 1, text: "ok" }], words: [] },
    ]);
    expect(merged[0].words).toBeUndefined();
  });

  it("keeps a word that starts a hair before its own line", () => {
    // Whisper's segment boundaries and its word timings come from different
    // passes and disagree at the seams. Filing by start time alone dropped the
    // first word of the episode, which cost that line its per-word timings and
    // left the fill sweeping the whole sentence.
    const merged = mergeSegments([
      {
        segments: [{ start: 0.5, end: 2, text: "hello there" }],
        words: [
          { start: 0.48, end: 1, text: "hello" },
          { start: 1, end: 2, text: "there" },
        ],
      },
    ]);

    expect(merged[0].words?.map((w) => w.text)).toEqual(["hello", "there"]);
  });

  it("gives a word straddling a boundary to the line holding more of it", () => {
    const merged = mergeSegments([
      {
        segments: [
          { start: 0, end: 2, text: "first" },
          { start: 2, end: 4, text: "second" },
        ],
        words: [
          { start: 0, end: 1.9, text: "first" },
          // Starts inside the first line but is mostly spoken in the second.
          { start: 1.9, end: 3.5, text: "second" },
        ],
      },
    ]);

    expect(merged[0].words?.map((w) => w.text)).toEqual(["first"]);
    expect(merged[1].words?.map((w) => w.text)).toEqual(["second"]);
  });

  it("never loses a word to the gap between two lines", () => {
    const merged = mergeSegments([
      {
        segments: [
          { start: 0, end: 1, text: "before" },
          { start: 5, end: 6, text: "after" },
        ],
        // Spoken in the silence between the two lines — Whisper does emit
        // these. It has to land somewhere rather than vanish.
        words: [{ start: 3, end: 3.5, text: "stray" }],
      },
    ]);

    const kept = merged.flatMap((s) => s.words ?? []).map((w) => w.text);
    expect(kept).toEqual(["stray"]);
  });
});

describe("timelineCoversAudio", () => {
  const segments = [{ start: 0, end: 90, text: "…" }];

  it("accepts timings that run to near the end of the audio", () => {
    expect(timelineCoversAudio(segments, 100)).toBe(true);
  });

  it("accepts a transcript that stops short for an outro", () => {
    // Music and trailing silence are not speech; the last caption always lands
    // before the last sample.
    expect(timelineCoversAudio(segments, 110)).toBe(true);
  });

  it("rejects a timeline that stops two thirds of the way through", () => {
    // Timings on a different clock from the audio: captions would gain on the
    // voice all episode, with no single offset that corrects it.
    expect(timelineCoversAudio([{ start: 0, end: 2400, text: "…" }], 3600)).toBe(false);
  });

  it("gives a server that reports no duration the benefit of the doubt", () => {
    expect(timelineCoversAudio(segments, undefined)).toBe(true);
    expect(timelineCoversAudio(segments, 0)).toBe(true);
    expect(timelineCoversAudio(segments, Number.NaN)).toBe(true);
  });

  it("does not reject an empty transcript on coverage — that is caught earlier", () => {
    expect(timelineCoversAudio([], 3600)).toBe(true);
  });
});

describe("detectAudioKind", () => {
  const bytes = (values: number[]) => new Uint8Array(values);
  const zeros = (n: number) => new Uint8Array(n);

  it("recognises an MP3 file that begins with an ID3v2 tag", () => {
    const head = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0, ...zeros(20)]);
    expect(detectAudioKind(head, "audio/mpeg")).toBe("mp3");
  });

  it("recognises a bare MP3 frame sync word", () => {
    // 0xFF 0xFB — MPEG-1 Layer III, no CRC.
    expect(detectAudioKind(bytes([0xff, 0xfb, 0x90, 0x64]), null)).toBe("mp3");
  });

  it("recognises an M4A file by its ftyp atom", () => {
    // ISO base media: 4-byte size, then "ftyp".
    const head = new Uint8Array([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70,
      0x4d, 0x34, 0x41, 0x20, ...zeros(16),
    ]);
    expect(detectAudioKind(head, "audio/mp4")).toBe("mp4");
  });

  it("falls back to Content-Type when the bytes are unrecognisable", () => {
    expect(detectAudioKind(zeros(4), "audio/mpeg")).toBe("mp3");
    expect(detectAudioKind(zeros(4), "audio/mp4")).toBe("mp4");
    expect(detectAudioKind(zeros(4), "audio/aac")).toBe("mp4");
  });

  it("returns 'other' when nothing identifies the file", () => {
    expect(detectAudioKind(zeros(4), "application/octet-stream")).toBe("other");
    expect(detectAudioKind(zeros(4), null)).toBe("other");
  });

  it("trusts magic bytes over a wrong Content-Type", () => {
    // A misconfigured host that labels an MP3 as octet-stream still gets identified.
    expect(detectAudioKind(bytes([0x49, 0x44, 0x33, 0x04]), "application/octet-stream")).toBe(
      "mp3",
    );
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

/**
 * End-to-end arithmetic of the fix, over the real chunking path.
 *
 * Builds a synthetic VBR episode, splits it exactly as `transcribeMp3Chunked`
 * would, prepares each chunk the way `fetchChunk` does, and checks that the
 * durations the timeline is built from add up to the real length of the audio.
 *
 * This is the test that would have caught the original bug: the failure was
 * never in one function, it was in the sum across boundaries.
 */
describe("chunked timeline arithmetic", () => {
  const KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const FRAME_SECONDS = 1152 / 44100;

  function frameAt(bitrateIndex: number): Uint8Array {
    const length = Math.floor((144 * KBPS[bitrateIndex] * 1000) / 44100);
    const bytes = new Uint8Array(length);
    bytes[0] = 0xff;
    bytes[1] = 0xfb;
    bytes[2] = (bitrateIndex << 4) | 0x00;
    bytes[3] = 0x00;
    return bytes;
  }

  /** A variable-bitrate stream, so byte position never implies time. */
  function episode(frames: number): { bytes: Uint8Array; seconds: number } {
    const parts: Uint8Array[] = [];
    for (let i = 0; i < frames; i += 1) {
      // Cycles 96 / 128 / 192 / 320 kbps — identical durations, different sizes.
      parts.push(frameAt([7, 9, 11, 14][i % 4]));
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      bytes.set(p, offset);
      offset += p.length;
    }
    return { bytes, seconds: frames * FRAME_SECONDS };
  }

  it("reconstructs the true episode length across many chunk boundaries", () => {
    const { bytes, seconds } = episode(4000);
    const ranges = planChunks(bytes.length, 100_000);

    // Enough boundaries to make an accumulating error obvious.
    expect(ranges.length).toBeGreaterThan(8);

    const measured = ranges.map(({ start, end }, i) =>
      frameSeconds(prepareChunk(bytes.subarray(start, end), i === 0)),
    );

    expect(measured.every((s) => s !== null)).toBe(true);
    const sum = measured.reduce((n: number, s) => n + (s ?? 0), 0);

    // Exact: every frame in the file is counted in exactly one chunk, so the
    // boundaries contribute no error at all — not "a little", none.
    expect(sum).toBeCloseTo(seconds, 9);
  });

  it("beats measuring by where speech stopped, which is what drifted", () => {
    const { bytes, seconds } = episode(4000);
    const ranges = planChunks(bytes.length, 100_000);

    // Each chunk's speech ends two seconds before its audio does — a music bed,
    // an outro, a pause. This is what Whisper's last word reports.
    const chunks = ranges.map(({ start, end }, i) => {
      const measured = frameSeconds(prepareChunk(bytes.subarray(start, end), i === 0))!;
      const spoken = Math.max(0, measured - 2);
      return {
        segments: [{ start: 0, end: spoken, text: `chunk ${i}` }],
        words: [],
        seconds: measured,
      };
    });

    const fixed = mergeSegments(chunks);
    // Same chunks, but with the measurement withheld — the old behaviour.
    const drifting = mergeSegments(chunks.map((c) => ({ ...c, seconds: null })));

    const lastFixed = fixed[fixed.length - 1].start;
    const lastDrifting = drifting[drifting.length - 1].start;

    // The old path places the final chunk two seconds early per boundary.
    expect(lastDrifting).toBeLessThan(lastFixed - 2 * (ranges.length - 2));
    // The new one lands exactly where the audio says it should.
    expect(lastFixed).toBeCloseTo(seconds - chunks[chunks.length - 1].seconds!, 9);
  });
});
