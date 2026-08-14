import { describe, expect, it } from 'vitest';
import { audioStart, chunkMp3, durationMs, frames, readFrameHeader } from './mp3.ts';

/**
 * Build one MPEG-1 Layer III frame.
 *
 * Synthesised rather than fixtured: a real MP3 in the repo would be a binary
 * blob nobody can inspect, and every property under test here is a property of
 * the header arithmetic, which is exactly what this makes explicit.
 */
function frame({
  kbps = 128,
  sampleRate = 44100,
  padding = 0,
  fill = 0x00,
}: { kbps?: number; sampleRate?: number; padding?: number; fill?: number } = {}): Uint8Array {
  const bitrateIndex = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320].indexOf(kbps);
  const rateIndex = [44100, 48000, 32000].indexOf(sampleRate);

  const length = Math.floor((144 * kbps * 1000) / sampleRate) + padding;
  const bytes = new Uint8Array(length).fill(fill);

  bytes[0] = 0xff;
  // MPEG-1 (11), Layer III (01), no CRC (1).
  bytes[1] = 0xfb;
  bytes[2] = (bitrateIndex << 4) | (rateIndex << 2) | (padding << 1);
  bytes[3] = 0xc0;

  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** An ID3v2 tag of `size` payload bytes, with the synchsafe length field. */
function id3(size: number, payloadFill = 0xff): Uint8Array {
  const out = new Uint8Array(10 + size).fill(payloadFill);
  out[0] = 0x49; // I
  out[1] = 0x44; // D
  out[2] = 0x33; // 3
  out[3] = 0x03;
  out[4] = 0x00;
  out[5] = 0x00;
  out[6] = (size >> 21) & 0x7f;
  out[7] = (size >> 14) & 0x7f;
  out[8] = (size >> 7) & 0x7f;
  out[9] = size & 0x7f;
  return out;
}

describe('readFrameHeader', () => {
  it('reads length and duration from a 128kbps 44.1kHz frame', () => {
    // 144 * 128000 / 44100 = 417.9… → 417 bytes; 1152 / 44100 = 26.12ms.
    const header = readFrameHeader(frame(), 0);
    expect(header).toMatchObject({ offset: 0, length: 417 });
    expect(header!.durationMs).toBeCloseTo(26.12, 2);
  });

  it('adds the padding byte when the padding bit is set', () => {
    // Padding is how CBR files hit an exact average rate. Ignoring it puts
    // every subsequent frame offset one byte further out than the last.
    expect(readFrameHeader(frame({ padding: 1 }), 0)!.length).toBe(418);
  });

  it('reads a 320kbps frame', () => {
    expect(readFrameHeader(frame({ kbps: 320 }), 0)!.length).toBe(1044);
  });

  it('rejects a false sync word', () => {
    // 0xFF 0xE0 with a reserved version. Compressed audio is full of these.
    const bytes = new Uint8Array([0xff, 0xe0, 0x00, 0x00]);
    expect(readFrameHeader(bytes, 0)).toBeNull();
  });

  it('rejects a free-format bitrate rather than computing a zero length', () => {
    const bytes = frame();
    bytes[2] = 0x00; // bitrate index 0
    expect(readFrameHeader(bytes, 0)).toBeNull();
  });

  it('rejects the reserved sample rate', () => {
    const bytes = frame();
    bytes[2] = (9 << 4) | (3 << 2); // rate index 3 is reserved
    expect(readFrameHeader(bytes, 0)).toBeNull();
  });

  it('rejects Layer I and Layer II', () => {
    const bytes = frame();
    bytes[1] = 0xff; // layer bits 11 = Layer I
    expect(readFrameHeader(bytes, 0)).toBeNull();
  });

  it('rejects a header running past the end of the buffer', () => {
    expect(readFrameHeader(new Uint8Array([0xff, 0xfb]), 0)).toBeNull();
  });
});

describe('audioStart', () => {
  it('skips an ID3v2 tag by its declared size', () => {
    expect(audioStart(concat(id3(500), frame()))).toBe(510);
  });

  it('reads the size field as synchsafe, not as a plain integer', () => {
    // 0x0000_0180 synchsafe is 128 + 128 = 256... read as big-endian it would
    // be 384, landing 128 bytes into the audio and losing the first frames.
    const tag = id3(256);
    expect(audioStart(tag)).toBe(266);
  });

  it('is not fooled by sync words inside cover art', () => {
    // The tag payload here is entirely 0xFF — the worst case for a scanner
    // that hunts for the first sync word instead of trusting the length.
    const bytes = concat(id3(1000, 0xff), frame());
    expect(audioStart(bytes)).toBe(1010);
    expect([...frames(bytes)]).toHaveLength(1);
  });

  it('returns zero for a file with no tag', () => {
    expect(audioStart(frame())).toBe(0);
  });
});

describe('frames', () => {
  it('walks a run of frames', () => {
    const found = [...frames(concat(frame(), frame(), frame()))];
    expect(found.map((f) => f.offset)).toEqual([0, 417, 834]);
  });

  it('resynchronises past garbage in the middle of a file', () => {
    // Podcast MP3s are concatenated from several encoders and carry mid-file
    // tags. Abandoning the file at the first surprise would lose the rest of
    // the episode.
    const junk = new Uint8Array(64).fill(0x13);
    const found = [...frames(concat(frame(), junk, frame()))];
    expect(found).toHaveLength(2);
    expect(found[1]!.offset).toBe(417 + 64);
  });

  it('stops cleanly on a truncated final frame', () => {
    const whole = concat(frame(), frame());
    const found = [...frames(whole.subarray(0, whole.length - 100))];
    // The second frame's header is intact and its declared length runs past the
    // end; it is still reported, and the walk terminates rather than looping.
    expect(found.length).toBeGreaterThanOrEqual(1);
  });

  it('finds nothing in a file that is not an MP3', () => {
    const notAudio = new TextEncoder().encode('<!doctype html><title>404</title>'.repeat(20));
    expect([...frames(notAudio)]).toHaveLength(0);
  });
});

describe('chunkMp3', () => {
  it('cuts only on frame boundaries', () => {
    // Three 417-byte frames, budget of 900: two frames then one.
    const bytes = concat(frame(), frame(), frame());
    const chunks = chunkMp3(bytes, 900);

    expect(chunks.map((c) => c.bytes.length)).toEqual([834, 417]);
    // Every chunk must itself parse as MP3, or the upload is rejected.
    for (const chunk of chunks) expect([...frames(chunk.bytes)].length).toBeGreaterThan(0);
  });

  it('reports each chunk’s offset within the episode', () => {
    // This is what shifts the returned cues back into episode time. Getting it
    // wrong puts every line after the first chunk at the wrong timestamp.
    const bytes = concat(...Array.from({ length: 6 }, () => frame()));
    const chunks = chunkMp3(bytes, 900);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.startMs).toBe(0);
    expect(chunks[1]!.startMs).toBe(Math.round(2 * (1152 / 44100) * 1000));
    expect(chunks[2]!.startMs).toBe(Math.round(4 * (1152 / 44100) * 1000));
  });

  it('offsets and durations tile the episode without gaps', () => {
    const bytes = concat(...Array.from({ length: 20 }, () => frame()));
    const chunks = chunkMp3(bytes, 2000);

    for (let i = 1; i < chunks.length; i += 1) {
      const previous = chunks[i - 1]!;
      expect(chunks[i]!.startMs).toBe(previous.startMs + previous.durationMs);
    }

    const last = chunks.at(-1)!;
    expect(last.startMs + last.durationMs).toBe(durationMs(bytes));
  });

  it('skips the ID3 tag rather than spending the budget on cover art', () => {
    const bytes = concat(id3(4000), frame(), frame());
    const chunks = chunkMp3(bytes, 10_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.bytes.length).toBe(834);
  });

  it('emits an oversized frame alone rather than dropping audio', () => {
    // A budget below one frame cannot be honoured. Discarding the frame would
    // leave an unexplained hole in the transcript; the upload refusing it is a
    // failure someone can read.
    const chunks = chunkMp3(frame(), 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.bytes.length).toBe(417);
  });

  it('returns nothing for a file that is not an MP3', () => {
    // The signal the caller needs: this is an AAC or a redirect page, and the
    // decision about that belongs upstream.
    expect(chunkMp3(new TextEncoder().encode('not audio at all'), 1000)).toEqual([]);
  });

  it('handles a variable-bitrate stream', () => {
    // VBR frames differ in length; the walk must follow each header rather than
    // assuming a stride.
    const bytes = concat(
      frame({ kbps: 128 }),
      frame({ kbps: 192 }),
      frame({ kbps: 64 }),
      frame({ kbps: 320 }),
    );
    expect([...frames(bytes)]).toHaveLength(4);
    expect(chunkMp3(bytes, 100_000)[0]!.bytes.length).toBe(bytes.length);
  });
});

describe('durationMs', () => {
  it('sums frame durations', () => {
    const bytes = concat(...Array.from({ length: 100 }, () => frame()));
    // 100 frames × 1152 samples ÷ 44100 Hz ≈ 2612ms.
    expect(durationMs(bytes)).toBe(2612);
  });

  it('is zero for a file with no frames', () => {
    expect(durationMs(new TextEncoder().encode('nope'))).toBe(0);
  });
});
