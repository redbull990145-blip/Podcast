/**
 * Measuring the served file without downloading it.
 *
 * The numbers in the Elevation case at the bottom are real: they were read off
 * the live feed and CDN, and they are here because the arithmetic agreeing with
 * `<itunes:duration>` to within a third of a second is the only evidence that
 * `<enclosure length>` really does describe the un-stitched master. Everything
 * else in this file is synthesised, for the reason `mp3.test.ts` gives — a
 * binary fixture is a blob nobody can inspect, and every property here is a
 * property of the header arithmetic.
 */

import { describe, expect, it } from 'vitest';
import { bytesPerSecondAt, findFrame, insertedAudio, readAudioShape, type AudioShape } from './detect.ts';

/**
 * A literal public IP, not a hostname — the same trick `audio.test.ts` uses.
 * The SSRF guard resolves hostnames for real, so `cdn.example.com` would fail at
 * DNS long before reaching the code under test.
 */
const URL_UNDER_TEST = 'https://93.184.216.34/episode.mp3';

function frame({
  kbps = 128,
  sampleRate = 44100,
  padding = 0,
  fill = 0x00,
}: { kbps?: number; sampleRate?: number; padding?: number; fill?: number } = {}): Uint8Array {
  const bitrateIndex = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
  ].indexOf(kbps);
  const rateIndex = [44100, 48000, 32000].indexOf(sampleRate);

  const length = Math.floor((144 * kbps * 1000) / sampleRate) + padding;
  const bytes = new Uint8Array(length).fill(fill);

  bytes[0] = 0xff;
  bytes[1] = 0xfb; // MPEG-1, Layer III, no CRC
  bytes[2] = (bitrateIndex << 4) | (rateIndex << 2) | (padding << 1);
  bytes[3] = 0xc0;

  return bytes;
}

function id3(size: number): Uint8Array {
  const out = new Uint8Array(10 + size).fill(0xff);
  out[0] = 0x49;
  out[1] = 0x44;
  out[2] = 0x33;
  out[3] = 0x03;
  out[4] = 0x00;
  // Flags. Must be written rather than left at the 0xff fill: bit 4 declares a
  // 10-byte footer, so a stray 0xff here moves the end of the tag and the test
  // measures a file it did not mean to build.
  out[5] = 0x00;
  out[6] = (size >> 21) & 0x7f;
  out[7] = (size >> 14) & 0x7f;
  out[8] = (size >> 7) & 0x7f;
  out[9] = size & 0x7f;
  return out;
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

/** `count` frames of the given shape, back to back. */
function frames(count: number, options: Parameters<typeof frame>[0] = {}): Uint8Array {
  return concat(...Array.from({ length: count }, () => frame(options)));
}

/** A CDN that honours `Range` and reports the true total in `Content-Range`. */
function rangedServer(file: Uint8Array): { fetchImpl: typeof fetch; requests: string[] } {
  const requests: string[] = [];

  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const range = new Headers(init.headers).get('range') ?? '';
    requests.push(range);

    const match = /bytes=(\d+)-(\d+)/.exec(range);
    if (!match) return new Response(file, { status: 200 });

    const from = Number(match[1]);
    const to = Math.min(Number(match[2]), file.length - 1);

    return new Response(file.subarray(from, to + 1), {
      status: 206,
      headers: { 'content-range': `bytes ${from}-${to}/${file.length}` },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, requests };
}

/** A CDN that ignores `Range` and starts sending the whole file. */
function wholeFileServer(file: Uint8Array): typeof fetch {
  return (async () =>
    new Response(file, {
      status: 200,
      headers: { 'content-length': String(file.length) },
    })) as unknown as typeof fetch;
}

describe('findFrame', () => {
  it('finds a frame that is not at offset zero', () => {
    const found = findFrame(concat(new Uint8Array(37).fill(0x11), frames(3)));
    expect(found?.offset).toBe(37);
    expect(found?.kbps).toBe(128);
    expect(found?.sampleRate).toBe(44100);
  });

  it('rejects a false sync that no second frame follows', () => {
    // Eleven set bits followed by a plausible-looking header, then noise. A
    // single-header test accepts this; requiring the next frame to land where
    // this one says it ends does not.
    const bait = new Uint8Array(600).fill(0x00);
    bait[0] = 0xff;
    bait[1] = 0xfb;
    bait[2] = 0x90;
    bait[3] = 0xc0;

    expect(findFrame(bait)).toBeNull();
  });

  it('accepts a lone frame when the buffer ends before the next could start', () => {
    expect(findFrame(frame())?.offset).toBe(0);
  });
});

describe('readAudioShape', () => {
  it('measures a constant-bitrate file from three small reads', async () => {
    // 2000 frames of 128kbps/44.1kHz — 26.122ms each, so ~52.2 seconds.
    const file = concat(id3(400), frames(2000));
    const { fetchImpl, requests } = rangedServer(file);

    const shape = await readAudioShape(URL_UNDER_TEST, { fetchImpl });

    expect(shape.status).toBe('ok');
    const ok = shape as AudioShape;
    expect(ok.kbps).toBe(128);
    expect(ok.sampleRate).toBe(44100);
    expect(ok.bytesPerSecond).toBe(16_000);
    expect(ok.constantBitrate).toBe(true);
    expect(ok.totalBytes).toBe(file.length);
    expect(ok.audioStart).toBe(410);

    // 2000 frames x 417 bytes / 16000 bytes per second.
    expect(ok.durationMs).toBe(Math.round((2000 * 417) / 16));

    // Two requests, neither large: the front of the file (which carries the tag
    // and the first frame together) and the tail.
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe('bytes=0-65535');
  });


  it('reads the tag length from the header, not from what was downloaded', async () => {
    // A 300KB ID3 tag — cover art, and far past the 64KB opening read. The tag's
    // declared length still places the audio correctly, at the cost of one extra
    // request for the frame itself.
    const file = concat(id3(300_000), frames(500));
    const { fetchImpl, requests } = rangedServer(file);

    const shape = await readAudioShape(URL_UNDER_TEST, { fetchImpl });

    expect((shape as AudioShape).audioStart).toBe(300_010);
    expect((shape as AudioShape).constantBitrate).toBe(true);
    expect(requests).toHaveLength(3);
  });

  it('refuses to convert bytes to seconds when the bitrate changes', async () => {
    // 64kbps at the front, 192kbps at the back: bytes and seconds are not
    // proportional here, and claiming a duration would be inventing one.
    const file = concat(id3(100), frames(1200, { kbps: 64 }), frames(1200, { kbps: 192 }));
    const { fetchImpl } = rangedServer(file);

    const shape = await readAudioShape(URL_UNDER_TEST, { fetchImpl });

    expect(shape.status).toBe('ok');
    expect((shape as AudioShape).constantBitrate).toBe(false);
    expect((shape as AudioShape).durationMs).toBeNull();
  });

  it('does not stream a whole episode to check a publisher that ignores Range', async () => {
    const file = concat(id3(100), frames(2000));
    const shape = await readAudioShape(URL_UNDER_TEST, { fetchImpl: wholeFileServer(file) });

    // Readable, but the tail was never fetched, so nothing is claimed about it.
    expect(shape.status).toBe('ok');
    expect((shape as AudioShape).constantBitrate).toBe(false);
    expect((shape as AudioShape).durationMs).toBeNull();
  });

  it('gives up rather than guessing when the size is unknown', async () => {
    const fetchImpl = (async () =>
      new Response(concat(id3(10), frames(5)), { status: 200 })) as unknown as typeof fetch;

    const shape = await readAudioShape(URL_UNDER_TEST, { fetchImpl });
    expect(shape.status).toBe('unreadable');
  });

  it('reports audio that is not an MP3 as unreadable, not as an error', async () => {
    const notAudio = new Uint8Array(8192).fill(0x42);
    const { fetchImpl } = rangedServer(notAudio);

    const shape = await readAudioShape(URL_UNDER_TEST, { fetchImpl });
    expect(shape.status).toBe('unreadable');
  });
});

describe('insertedAudio', () => {
  /** The live measurement, on episode `2305e9ce` of Elevation with Steven Furtick. */
  const elevation: AudioShape = {
    status: 'ok',
    totalBytes: 48_320_613,
    audioStart: 49_157,
    kbps: 128,
    sampleRate: 44_100,
    bytesPerSecond: bytesPerSecondAt(128),
    constantBitrate: true,
    durationMs: 3_016_966,
  };

  it('recovers the inserted ad from the two byte counts', () => {
    const inserted = insertedAudio(elevation, 48_181_533);

    expect(inserted).not.toBeNull();
    expect(inserted!.extraBytes).toBe(139_080);
    // 8.7 seconds that every cue past the insertion point is out by.
    expect(inserted!.insertedMs).toBe(8693);
  });

  it('agrees with the publisher about how long the master ran', () => {
    const inserted = insertedAudio(elevation, 48_181_533)!;

    // `<itunes:duration>` on that episode is 3008s. Deriving the same figure
    // from the byte count is what establishes that the declared length
    // describes the master rather than the stitched copy.
    expect(inserted.declaredDurationMs / 1000).toBeCloseTo(3008, 0);
  });

  it('says nothing when the bitrate cannot carry the arithmetic', () => {
    expect(insertedAudio({ ...elevation, constantBitrate: false }, 48_181_533)).toBeNull();
  });

  it('says nothing when the feed declared no length', () => {
    expect(insertedAudio(elevation, null)).toBeNull();
    expect(insertedAudio(elevation, 0)).toBeNull();
  });

  it('reports a negative insertion rather than hiding it', () => {
    // The served copy being *shorter* than declared is not something a stitcher
    // does, so it means the declared length is wrong. Better surfaced as an
    // implausible number than silently clamped to zero.
    const inserted = insertedAudio(elevation, 48_500_000)!;
    expect(inserted.insertedMs).toBeLessThan(0);
  });
});
