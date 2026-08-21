/**
 * Which audio failures are worth retrying, and how far a download may run.
 *
 * The queue retries a transcription three times, and until now it retried
 * everything three times — including an episode that is simply too big, which
 * meant downloading it, throwing it away, and doing that twice more to reach
 * the conclusion the first attempt already had. The listener watched "Writing
 * captions…" for several minutes to be told something knowable in seconds.
 *
 * So `streamAudioChunks` says whether a failure is permanent, and these are the
 * cases that classification has to get right. The bias is deliberate: anything
 * unclassified is transient, because a wrong "permanent" is a dead end shown to
 * someone whose episode would have worked on the next try, and a wrong
 * "transient" only costs two retries.
 */

import { describe, expect, it } from 'vitest';
import { streamAudioChunks } from './audio.ts';
import type { Mp3Chunk } from './mp3.ts';

/**
 * A literal public IP, not a hostname.
 *
 * The SSRF guard in front of this resolves hostnames for real before allowing a
 * fetch, so `cdn.example.com` fails at DNS and never reaches the code under
 * test. A literal address skips resolution entirely and is range-checked
 * directly — and because `fetchImpl` is injected, nothing is dialled either way.
 */
const URL_UNDER_TEST = 'https://93.184.216.34/episode.mp3';

/** Small and arbitrary — nothing in these tests cares about the actual budget. */
const TEST_CHUNK_BYTES = 64 * 1024;

/** A fetch that answers once with whatever the test needs. */
function respondWith(init: {
  status?: number;
  headers?: Record<string, string>;
  body?: Uint8Array | null;
}): typeof fetch {
  return (async () =>
    new Response(init.body === null ? null : (init.body ?? new Uint8Array([1, 2, 3])), {
      status: init.status ?? 200,
      headers: init.headers ?? {},
    })) as unknown as typeof fetch;
}

/** Collects whatever `onChunk` receives, for tests that care what was uploaded. */
function collector(): { chunks: Mp3Chunk[]; onChunk: (chunk: Mp3Chunk) => Promise<void> } {
  const chunks: Mp3Chunk[] = [];
  return { chunks, onChunk: async (chunk) => void chunks.push(chunk) };
}

async function outcomeOf(init: Parameters<typeof respondWith>[0]) {
  const { onChunk } = collector();
  return streamAudioChunks(URL_UNDER_TEST, TEST_CHUNK_BYTES, onChunk, {
    fetchImpl: respondWith(init),
  });
}

describe('streamAudioChunks', () => {
  it('reads an ordinary enclosure', async () => {
    const outcome = await outcomeOf({ headers: { 'content-type': 'audio/mpeg' } });
    expect(outcome.status).toBe('ok');
  });

  it('hands a small, unrecognised-format file over whole', async () => {
    // Three raw bytes: not MP3, comfortably under the chunk budget. This is
    // the AAC-in-MP4 case — this code cannot split it, so the right answer is
    // to let Whisper try rather than refuse on our own uncertainty.
    const { chunks, onChunk } = collector();
    const outcome = await streamAudioChunks(URL_UNDER_TEST, TEST_CHUNK_BYTES, onChunk, {
      fetchImpl: respondWith({ body: new Uint8Array([1, 2, 3]) }),
    });

    expect(outcome.status).toBe('ok');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  /**
   * The case that started this. A file over the ceiling is over the ceiling on
   * every attempt, so it must fail once rather than three times.
   */
  it('calls a declared over-size file permanent', async () => {
    const outcome = await outcomeOf({
      headers: { 'content-length': String(600 * 1024 * 1024) },
    });

    expect(outcome).toMatchObject({
      status: 'error',
      permanent: true,
      detail: expect.stringContaining('too long'),
    });
  });

  /**
   * `content-length` comes from the same server that would be lying about it,
   * so the ceiling is enforced again while the bytes arrive — and that path has
   * to reach the same verdict as the declared one.
   *
   * This is also the test that would have caught the original bug this whole
   * module exists to fix: a naive rewrite that buffers everything before
   * checking would hold the full 500MB-plus in memory before ever reaching
   * this assertion. Streamed correctly, the ceiling trips mid-download and the
   * buffered total never approaches it.
   */
  it('calls an undeclared over-size file permanent too', async () => {
    const oversize = new Uint8Array(1024 * 1024);
    let sent = 0;

    const streaming = (async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            // 600 chunks of 1MB, past the 500MB ceiling, with no
            // `content-length` to warn anybody first.
            if (sent >= 600) return controller.close();
            sent += 1;
            controller.enqueue(oversize);
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const { onChunk } = collector();
    const outcome = await streamAudioChunks(URL_UNDER_TEST, TEST_CHUNK_BYTES, onChunk, {
      fetchImpl: streaming,
    });

    expect(outcome).toMatchObject({ status: 'error', permanent: true });
  });

  /**
   * The bug this whole rewrite was for: a real, valid, long MP3 that simply
   * runs past the old whole-buffer ceiling must now succeed. Built from many
   * tiny frames rather than one huge synthetic buffer, so the test exercises
   * the same "many small network reads" path a real download takes.
   */
  it('transcribes a long MP3 that would have exceeded the old memory-bound ceiling', async () => {
    const frameBytes = mp3Frame();
    const frameCount = 4000; // several MB, comfortably over TEST_CHUNK_BYTES several times over
    const whole = new Uint8Array(frameBytes.length * frameCount);
    for (let i = 0; i < frameCount; i += 1) whole.set(frameBytes, i * frameBytes.length);

    let offset = 0;
    const trickle = (async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            if (offset >= whole.length) return controller.close();
            // 4KB reads: small enough that a frame or a chunk boundary
            // routinely lands mid-network-read, which is exactly the case
            // that broke on the first attempt at the streaming chunker.
            const end = Math.min(offset + 4096, whole.length);
            controller.enqueue(whole.subarray(offset, end));
            offset = end;
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const { chunks, onChunk } = collector();
    const outcome = await streamAudioChunks(URL_UNDER_TEST, TEST_CHUNK_BYTES, onChunk, {
      fetchImpl: trickle,
    });

    expect(outcome.status).toBe('ok');
    expect(chunks.length).toBeGreaterThan(1);

    const rebuilt = new Uint8Array(chunks.reduce((sum, c) => sum + c.bytes.length, 0));
    let at = 0;
    for (const chunk of chunks) {
      rebuilt.set(chunk.bytes, at);
      at += chunk.bytes.length;
    }
    expect(rebuilt).toEqual(whole);
  });

  it('calls a publisher 404 permanent', async () => {
    const outcome = await outcomeOf({ status: 404 });
    expect(outcome).toMatchObject({ status: 'error', permanent: true });
  });

  /**
   * The other half of the rule, and the one that protects listeners: a
   * publisher having a bad minute must still earn its retries.
   */
  it('leaves a publisher 503 retryable', async () => {
    const outcome = await outcomeOf({ status: 503 });
    expect(outcome).toMatchObject({ status: 'error' });
    expect((outcome as { permanent?: boolean }).permanent).toBeFalsy();
  });

  it('leaves an unreachable host retryable', async () => {
    const { onChunk } = collector();
    const outcome = await streamAudioChunks(URL_UNDER_TEST, TEST_CHUNK_BYTES, onChunk, {
      fetchImpl: (async () => {
        throw new Error('socket hang up');
      }) as unknown as typeof fetch,
    });

    expect(outcome).toMatchObject({ status: 'error' });
    expect((outcome as { permanent?: boolean }).permanent).toBeFalsy();
  });

  /**
   * The regression this guards: an earlier version wrapped the whole read
   * loop, including `onChunk`, in one `try/catch` — so a Groq rate limit
   * thrown from inside `onChunk` was caught here and flattened into a
   * "download failed" error, discarding its real classification (and, for a
   * 429, its `retryAfterSec`). `onChunk` errors must propagate as themselves.
   */
  it('lets an onChunk failure propagate rather than reporting it as a download error', async () => {
    class UploadFailed extends Error {}

    await expect(
      streamAudioChunks(
        URL_UNDER_TEST,
        TEST_CHUNK_BYTES,
        async () => {
          throw new UploadFailed('Groq is rate-limiting your key');
        },
        { fetchImpl: respondWith({ body: new Uint8Array([1, 2, 3]) }) },
      ),
    ).rejects.toBeInstanceOf(UploadFailed);
  });

  it('reports "unsplittable" for a large file that never resolves to MP3 frames', async () => {
    // Bigger than one chunk budget and never a valid frame anywhere in it —
    // the AAC-in-MP4 case, but too large to send whole.
    const junk = new Uint8Array(TEST_CHUNK_BYTES * 2).fill(0x13);
    const { onChunk } = collector();
    const outcome = await streamAudioChunks(URL_UNDER_TEST, TEST_CHUNK_BYTES, onChunk, {
      fetchImpl: respondWith({ body: junk }),
    });

    expect(outcome).toMatchObject({ status: 'unsplittable' });
  });
});

/** One minimal, valid MPEG-1 Layer III frame header plus silent payload. */
function mp3Frame(): Uint8Array {
  const kbps = 128;
  const sampleRate = 44100;
  const bitrateIndex = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320].indexOf(kbps);
  const rateIndex = [44100, 48000, 32000].indexOf(sampleRate);
  const length = Math.floor((144 * kbps * 1000) / sampleRate);

  const bytes = new Uint8Array(length);
  bytes[0] = 0xff;
  bytes[1] = 0xfb; // MPEG-1, Layer III, no CRC
  bytes[2] = (bitrateIndex << 4) | (rateIndex << 2);
  bytes[3] = 0xc0;
  return bytes;
}
