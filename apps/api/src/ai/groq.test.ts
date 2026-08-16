import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withRetry } from './groq.ts';

/**
 * The retry that exists because of a real failure.
 *
 * A transcription of an hour-long episode is several sequential 20MB uploads,
 * and a single 502 from Groq's gateway on any one of them threw away every
 * chunk before it and spent the user's daily allowance to produce nothing. The
 * cases below are the whole policy: retry what is transient, surface what is
 * not, and never retry something the caller has abandoned.
 *
 * Fake timers throughout — the backoff is seconds long by design, and a test
 * suite should not wait it out.
 */
describe('withRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Run `promise` to settlement while letting every pending timer fire. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    // `error?: undefined` on the success arm so the read below does not depend
    // on narrowing, which `strict: false` disables — see url-guard.ts.
    const result: Promise<
      { ok: true; value: T; error?: undefined } | { ok: false; error: unknown }
    > = promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.runAllTimersAsync();
    const outcome = await result;
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  function response(status: number): Response {
    // A body on every response, so the cancel-before-retry path is exercised
    // rather than skipped by a null body.
    return new Response('{}', { status });
  }

  it('retries a 502 and returns the attempt that works', async () => {
    const send = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(response(502))
      .mockResolvedValueOnce(response(200));

    const result = await settle(withRetry(send));

    expect(result.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('gives up after three attempts and hands back the last response', async () => {
    // The final response is returned rather than thrown so the caller can read
    // Groq's own message out of the body for the error it shows.
    const send = vi.fn<() => Promise<Response>>().mockResolvedValue(response(503));

    const result = await settle(withRetry(send));

    expect(result.status).toBe(503);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('does not retry a rejected key', async () => {
    // 401 will be 401 again. Retrying delays the one message that tells the
    // user their key is wrong.
    const send = vi.fn<() => Promise<Response>>().mockResolvedValue(response(401));

    const result = await settle(withRetry(send));

    expect(result.status).toBe(401);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not retry a rate limit', async () => {
    // Retrying immediately is the least helpful possible response to a 429.
    const send = vi.fn<() => Promise<Response>>().mockResolvedValue(response(429));

    await settle(withRetry(send));

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not retry audio that was too large', async () => {
    const send = vi.fn<() => Promise<Response>>().mockResolvedValue(response(413));

    await settle(withRetry(send));

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries a dropped socket, which a 20MB upload does often enough', async () => {
    const send = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response(200));

    const result = await settle(withRetry(send));

    expect(result.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rethrows a network failure that never recovers', async () => {
    const send = vi.fn<() => Promise<Response>>().mockRejectedValue(new TypeError('fetch failed'));

    await expect(settle(withRetry(send))).rejects.toThrow('fetch failed');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('stops immediately when the caller has aborted', async () => {
    // An abort is the caller going away, not the provider failing. Retrying it
    // would be doing work for a request nobody is waiting on.
    const controller = new AbortController();
    controller.abort();

    const error = new Error('aborted');
    error.name = 'AbortError';
    const send = vi.fn<() => Promise<Response>>().mockRejectedValue(error);

    await expect(settle(withRetry(send, controller.signal))).rejects.toThrow('aborted');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('calls `send` afresh each time, so a consumed body is never resent', async () => {
    // The transcription body is a stream inside a FormData and can only be read
    // once. Retrying by reusing the same request would upload nothing at all —
    // a failure that looks nothing like the 502 that triggered it.
    const bodies: string[] = [];
    let attempt = 0;
    const send = vi.fn<() => Promise<Response>>().mockImplementation(() => {
      attempt += 1;
      bodies.push(`body-${attempt}`);
      return Promise.resolve(response(attempt === 1 ? 502 : 200));
    });

    await settle(withRetry(send));

    expect(bodies).toEqual(['body-1', 'body-2']);
  });
});
