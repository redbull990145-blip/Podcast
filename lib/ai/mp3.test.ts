import { describe, expect, it } from "vitest";
import {
  audioStartOffset,
  findFrame,
  frameSeconds,
  id3v2Length,
  measureFrames,
  parseFrameHeader,
  prepareChunk,
} from "./mp3";

/**
 * Builds a 128kbps 44.1kHz MPEG1 Layer III stereo frame header.
 * Frame length works out to floor(144 * 128000 / 44100) = 417 bytes.
 */
const FRAME_LENGTH = 417;

function frame(fill = 0x00): Uint8Array {
  const bytes = new Uint8Array(FRAME_LENGTH).fill(fill);
  bytes[0] = 0xff;
  bytes[1] = 0xfb; // MPEG1, Layer III, no CRC
  bytes[2] = 0x90; // bitrate index 9 (128k), sample index 0 (44.1k), no padding
  bytes[3] = 0x00; // stereo
  return bytes;
}

/** A frame carrying a Xing VBR header at the usual MPEG1-stereo offset. */
function xingFrame(tag = "Xing"): Uint8Array {
  const bytes = frame();
  const at = 4 + 32; // 36 bytes in, per MPEG1 stereo layout
  for (let i = 0; i < 4; i += 1) bytes[at + i] = tag.charCodeAt(i);
  return bytes;
}

function id3Tag(payloadSize: number): Uint8Array {
  const bytes = new Uint8Array(10 + payloadSize);
  bytes[0] = 0x49; // I
  bytes[1] = 0x44; // D
  bytes[2] = 0x33; // 3
  bytes[3] = 0x03; // version
  bytes[5] = 0x00; // flags, no footer
  // Syncsafe size, 7 bits per byte.
  bytes[6] = (payloadSize >> 21) & 0x7f;
  bytes[7] = (payloadSize >> 14) & 0x7f;
  bytes[8] = (payloadSize >> 7) & 0x7f;
  bytes[9] = payloadSize & 0x7f;
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

describe("parseFrameHeader", () => {
  it("computes the frame length of a 128kbps 44.1kHz MPEG1 frame", () => {
    expect(parseFrameHeader(frame(), 0)).toEqual({
      offset: 0,
      length: FRAME_LENGTH,
      samples: 1152,
      sampleRate: 44100,
    });
  });

  it("accounts for the padding bit", () => {
    const bytes = frame();
    bytes[2] |= 0x02; // padding on
    expect(parseFrameHeader(bytes, 0)?.length).toBe(FRAME_LENGTH + 1);
  });

  it("rejects a missing sync word", () => {
    const bytes = frame();
    bytes[0] = 0xfe;
    expect(parseFrameHeader(bytes, 0)).toBeNull();
  });

  it("rejects the reserved MPEG version", () => {
    const bytes = frame();
    bytes[1] = 0xeb; // version bits = 01, reserved
    expect(parseFrameHeader(bytes, 0)).toBeNull();
  });

  it("rejects layers other than III", () => {
    const bytes = frame();
    bytes[1] = 0xfd; // layer bits = 10 (Layer II)
    expect(parseFrameHeader(bytes, 0)).toBeNull();
  });

  it("rejects the free and bad bitrate indices", () => {
    for (const index of [0x00, 0xf0]) {
      const bytes = frame();
      bytes[2] = index | 0x00;
      expect(parseFrameHeader(bytes, 0)).toBeNull();
    }
  });

  it("rejects a truncated header at the end of the buffer", () => {
    expect(parseFrameHeader(frame().subarray(0, 3), 0)).toBeNull();
  });
});

describe("id3v2Length", () => {
  it("reads a syncsafe size", () => {
    expect(id3v2Length(id3Tag(1000))).toBe(1010);
  });

  it("decodes sizes above 127, where syncsafe encoding matters", () => {
    expect(id3v2Length(id3Tag(300_000))).toBe(300_010);
  });

  it("adds the footer when the flag is set", () => {
    const tag = id3Tag(500);
    tag[5] = 0x10;
    expect(id3v2Length(tag)).toBe(520);
  });

  it("returns 0 when there is no tag", () => {
    expect(id3v2Length(frame())).toBe(0);
  });
});

describe("findFrame", () => {
  it("finds a frame at the very start", () => {
    expect(findFrame(concat(frame(), frame()))?.offset).toBe(0);
  });

  it("skips leading junk to the first real frame", () => {
    const junk = new Uint8Array(100).fill(0x11);
    expect(findFrame(concat(junk, frame(), frame()))?.offset).toBe(100);
  });

  it("ignores a false sync not followed by a consistent second frame", () => {
    // 0xFF 0xFB looks like a header but is isolated garbage here.
    const decoy = new Uint8Array(50).fill(0x00);
    decoy[10] = 0xff;
    decoy[11] = 0xfb;
    decoy[12] = 0x90;

    expect(findFrame(concat(decoy, frame(), frame()))?.offset).toBe(50);
  });

  it("returns null when there is no frame at all", () => {
    expect(findFrame(new Uint8Array(500).fill(0x42))).toBeNull();
  });
});

describe("audioStartOffset", () => {
  it("skips an ID3v2 tag", () => {
    const bytes = concat(id3Tag(200), frame(), frame());
    expect(audioStartOffset(bytes)).toBe(210);
  });

  it("skips a Xing header frame so the declared duration is dropped", () => {
    // This is the case that made Groq spend two minutes and return 502.
    const bytes = concat(id3Tag(100), xingFrame(), frame(), frame());
    expect(audioStartOffset(bytes)).toBe(110 + FRAME_LENGTH);
  });

  it.each(["Info", "VBRI"])("also skips a %s header frame", (tag) => {
    const bytes = concat(xingFrame(tag), frame(), frame());
    expect(audioStartOffset(bytes)).toBe(FRAME_LENGTH);
  });

  it("leaves a plain frame stream untouched", () => {
    expect(audioStartOffset(concat(frame(), frame()))).toBe(0);
  });
});

describe("prepareChunk", () => {
  it("strips tag and VBR header from the first chunk", () => {
    const bytes = concat(id3Tag(64), xingFrame(), frame(0xaa), frame(0xaa));
    const out = prepareChunk(bytes, true);

    expect(out.length).toBe(FRAME_LENGTH * 2);
    expect(parseFrameHeader(out, 0)).not.toBeNull();
  });

  it("aligns a mid-file chunk to the next frame boundary", () => {
    // A slice that begins partway through a frame, as a byte-range fetch does.
    const partial = frame().subarray(100);
    const bytes = concat(partial, frame(), frame());
    const out = prepareChunk(bytes, false);

    expect(out.length).toBe(FRAME_LENGTH * 2);
    expect(parseFrameHeader(out, 0)).not.toBeNull();
  });

  it("does not strip metadata from a later chunk", () => {
    // A Xing-looking frame mid-file is real audio as far as we're concerned;
    // only chunk zero carries genuine file-level metadata.
    const bytes = concat(xingFrame(), frame(), frame());
    expect(prepareChunk(bytes, false).length).toBe(bytes.length);
  });

  it("passes unparseable audio through untouched rather than mangling it", () => {
    const bytes = new Uint8Array(300).fill(0x42);
    expect(prepareChunk(bytes, true)).toEqual(bytes);
    expect(prepareChunk(bytes, false)).toEqual(bytes);
  });
});

/** One MPEG1 Layer III frame at 44.1kHz: 1152 samples. */
const FRAME_SECONDS = 1152 / 44100;

/** A frame at an arbitrary bitrate index, for building VBR streams. */
function frameAt(bitrateIndex: number): Uint8Array {
  const kbps = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const length = Math.floor((144 * kbps[bitrateIndex] * 1000) / 44100);
  const bytes = new Uint8Array(length);
  bytes[0] = 0xff;
  bytes[1] = 0xfb;
  bytes[2] = (bitrateIndex << 4) | 0x00;
  bytes[3] = 0x00;
  return bytes;
}

describe("frameSeconds", () => {
  it("sums the real duration of a run of frames", () => {
    const bytes = concat(...Array.from({ length: 100 }, () => frame()));
    expect(frameSeconds(bytes)).toBeCloseTo(FRAME_SECONDS * 100, 9);
  });

  it("is exact for a variable-bitrate stream", () => {
    // Every frame is a different size in bytes and identical in duration, which
    // is the whole reason bitrate can't be used to measure a VBR file.
    const bytes = concat(frameAt(5), frameAt(9), frameAt(14), frameAt(2), frameAt(11));
    expect(frameSeconds(bytes)).toBeCloseTo(FRAME_SECONDS * 5, 9);
  });

  it("counts a frame cut in half by the end of the range", () => {
    // Its header is here, and the next chunk starts at the following header
    // because the orphaned body has none to be found by — so this is the one
    // place it can be counted, and counting it is what makes the sum exact.
    const bytes = concat(frame(), frame(), frame().subarray(0, 100));
    expect(frameSeconds(bytes)).toBeCloseTo(FRAME_SECONDS * 3, 9);
  });

  it("skips a leading ID3 tag by resyncing to the first real frame", () => {
    const bytes = concat(id3Tag(500), frame(), frame());
    expect(frameSeconds(bytes)).toBeCloseTo(FRAME_SECONDS * 2, 9);
  });

  it("returns null when there is no parseable audio", () => {
    expect(frameSeconds(new Uint8Array(4096).fill(0x42))).toBeNull();
    expect(frameSeconds(new Uint8Array(0))).toBeNull();
  });

  it("measures a chunk independently of how much of it is speech", () => {
    // The bug this exists to prevent: a chunk ending in silence or music is
    // exactly as long as one ending on a word, and only the container knows it.
    const speech = concat(...Array.from({ length: 40 }, () => frame()));
    const silence = concat(...Array.from({ length: 60 }, () => frame()));
    expect(frameSeconds(concat(speech, silence))).toBeCloseTo(FRAME_SECONDS * 100, 9);
  });
});

/**
 * What happens at an ad splice point.
 *
 * These are the regressions that made captions drift on exactly the shows whose
 * hosts stitch advertising into the file, and only those. Both used to return a
 * duration short by everything after the splice, which `mergeSegments` then
 * spent placing every later chunk too early.
 */
describe("measureFrames at a stitch point", () => {
  it("reads a mid-stream ID3 tag rather than resyncing past it", () => {
    // The tag a stitcher writes between two segments, carrying album art.
    const bytes = concat(frame(), frame(), id3Tag(300_000), frame(), frame());
    const measured = measureFrames(bytes);

    expect(measured.seconds).toBeCloseTo(FRAME_SECONDS * 4, 9);
    expect(measured.framesCounted).toBe(4);
    // A declared tag length is knowledge, not a gap — nothing was guessed at.
    expect(measured.skippedBytes).toBe(0);
  });

  it("counts audio after a tag too large to resync past", () => {
    // Larger than RESYNC_LIMIT, which is precisely the case that used to make
    // the loop give up and abandon the rest of the chunk.
    const bytes = concat(frame(), id3Tag(200 * 1024), frame(), frame());
    expect(frameSeconds(bytes)).toBeCloseTo(FRAME_SECONDS * 3, 9);
  });

  it("keeps scanning past junk it cannot resync through", () => {
    // 200KB of noise: three failed resync windows before real audio resumes.
    const junk = new Uint8Array(200 * 1024).fill(0x42);
    const bytes = concat(frame(), frame(), junk, frame(), frame(), frame());
    const measured = measureFrames(bytes);

    expect(measured.framesCounted).toBe(5);
    expect(measured.seconds).toBeCloseTo(FRAME_SECONDS * 5, 9);
    // Reported rather than swallowed, so the caller can distrust the number.
    expect(measured.skippedBytes).toBeGreaterThanOrEqual(junk.length);
  });

  it("resyncs through junk smaller than one window without losing the tail", () => {
    const junk = new Uint8Array(1024).fill(0x42);
    const bytes = concat(frame(), junk, frame(), frame());
    const measured = measureFrames(bytes);

    expect(measured.seconds).toBeCloseTo(FRAME_SECONDS * 3, 9);
    expect(measured.skippedBytes).toBe(junk.length);
  });

  it("reports nothing understood for a run with no frames at all", () => {
    const measured = measureFrames(new Uint8Array(4096).fill(0x42));
    expect(measured.framesCounted).toBe(0);
    expect(measured.skippedBytes).toBeGreaterThan(0);
    expect(frameSeconds(new Uint8Array(4096).fill(0x42))).toBeNull();
  });

  it("terminates on a tag whose declared length overruns the buffer", () => {
    // A tag cut in half by the end of a byte range. The rest is in the next
    // chunk; this one simply ends.
    const bytes = concat(frame(), id3Tag(500_000).subarray(0, 2048));
    expect(measureFrames(bytes).framesCounted).toBe(1);
  });
});
