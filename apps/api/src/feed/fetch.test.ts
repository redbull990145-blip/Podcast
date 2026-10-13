import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFeed } from './fetch.ts';

afterEach(() => { vi.useRealTimers(); });

describe('feed fetch failure recovery', () => {
  it('does not send a pre-aborted request', async () => {
    const controller = new AbortController(); controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await fetchFeed('https://8.8.8.8/feed', { signal: controller.signal, fetchImpl })).toMatchObject({ status: 'error', retryable: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects malformed redirect targets as a result rather than throwing', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://[' } }));
    await expect(fetchFeed('https://8.8.8.8/feed', { fetchImpl })).resolves.toMatchObject({ status: 'error', retryable: false });
  });

  it('cancels redirect bodies before following the next checked hop', async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 302, headers: { location: 'https://1.1.1.1/feed' } }))
      .mockResolvedValueOnce(new Response('<rss/>'));
    expect(await fetchFeed('https://8.8.8.8/feed', { fetchImpl })).toMatchObject({ status: 'ok' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('bounds stalled headers even when a fetch implementation ignores cancellation', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined));
    const pending = fetchFeed('https://8.8.8.8/feed', { fetchImpl });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await Promise.race([pending, Promise.resolve('unsettled')])).toMatchObject({ status: 'error', retryable: true });
  });

  it('bounds a stalled body and cancels its reader', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = fetchFeed('https://8.8.8.8/feed', { fetchImpl });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await Promise.race([pending, Promise.resolve('unsettled')])).toMatchObject({ status: 'error', retryable: true });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['declared', 'streamed'])('bounds stalled cleanup after a %s oversized body', async (sizeSource) => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (sizeSource === 'streamed') controller.enqueue(new Uint8Array(32 * 1024 * 1024 + 1));
      },
      cancel,
    });
    const response = new Response(body, { headers: sizeSource === 'declared' ? { 'content-length': '999999999' } : {} });
    const pending = fetchFeed('https://8.8.8.8/feed', { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response) });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await Promise.race([pending, Promise.resolve('unsettled')])).toMatchObject({ status: 'error', retryable: true });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
