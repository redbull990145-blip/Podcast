/**
 * Which audio failures are worth retrying.
 *
 * The queue retries a transcription three times, and until now it retried
 * everything three times — including an episode that is simply too big, which
 * meant downloading up to 120MB, throwing it away, and doing that twice more
 * to reach the conclusion the first attempt already had. The listener watched
 * "Writing captions…" for several minutes to be told something knowable in
 * seconds.
 *
 * So `fetchAudio` now says whether a failure is permanent, and these are the
 * cases that classification has to get right. The bias is deliberate: anything
 * unclassified is transient, because a wrong "permanent" is a dead end shown to
 * someone whose episode would have worked on the next try, and a wrong
 * "transient" only costs two retries.
 */

import { describe, expect, it } from 'vitest';
import { fetchAudio } from './audio.ts';

/**
 * A literal public IP, not a hostname.
 *
 * The SSRF guard in front of this resolves hostnames for real before allowing a
 * fetch, so `cdn.example.com` fails at DNS and never reaches the code under
 * test. A literal address skips resolution entirely and is range-checked
 * directly — and because `fetchImpl` is injected, nothing is dialled either way.
 */
const URL_UNDER_TEST = 'https://93.184.216.34/episode.mp3';

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

async function outcomeOf(init: Parameters<typeof respondWith>[0]) {
  return fetchAudio(URL_UNDER_TEST, { fetchImpl: respondWith(init) });
}

describe('audio fetch', () => {
  it('reads an ordinary enclosure', async () => {
    const outcome = await outcomeOf({ headers: { 'content-type': 'audio/mpeg' } });
    expect(outcome.status).toBe('ok');
  });

  /**
   * The case that started this. A file over the ceiling is over the ceiling on
   * every attempt, so it must fail once rather than three times.
   */
  it('calls a declared over-size file permanent', async () => {
    const outcome = await outcomeOf({
      headers: { 'content-length': String(200 * 1024 * 1024) },
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
   */
  it('calls an undeclared over-size file permanent too', async () => {
    const oversize = new Uint8Array(1024 * 1024);
    let sent = 0;

    const streaming = (async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            // 200 chunks of 1MB, past the 120MB ceiling, with no
            // `content-length` to warn anybody first.
            if (sent >= 200) return controller.close();
            sent += 1;
            controller.enqueue(oversize);
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const outcome = await fetchAudio(URL_UNDER_TEST, { fetchImpl: streaming });

    expect(outcome).toMatchObject({ status: 'error', permanent: true });
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
    const outcome = await fetchAudio(URL_UNDER_TEST, {
      fetchImpl: (async () => {
        throw new Error('socket hang up');
      }) as unknown as typeof fetch,
    });

    expect(outcome).toMatchObject({ status: 'error' });
    expect((outcome as { permanent?: boolean }).permanent).toBeFalsy();
  });
});
