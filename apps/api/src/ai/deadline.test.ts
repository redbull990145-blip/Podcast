import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { delay, fetchWithDeadline } from './deadline.ts';
import {
  chat,
  chatStream,
  transcribe,
  withRetry,
  CHAT_OPERATION_MS,
  TRANSCRIBE_OPERATION_BASE_MS,
} from './groq.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const captured = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
describe('provider deadlines and cancellation', () => {
  it('bounds a fetch that never returns headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const work = captured(fetchWithDeadline('https://provider.test', {}, 100));
    await vi.advanceTimersByTimeAsync(100);
    expect((await work).error).toMatchObject({ name: 'TimeoutError' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a stalled body after successful headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new ReadableStream())),
    );
    const response = await fetchWithDeadline('https://provider.test', {}, 100);
    const body = captured(response.json());
    await vi.advanceTimersByTimeAsync(100);
    expect((await body).error).toMatchObject({ name: 'TimeoutError' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('disposes deadline timers after ordinary body consumption', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}')),
    );
    const response = await fetchWithDeadline('https://provider.test', {}, 100);
    await response.json();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not send an already cancelled provider call', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchWithDeadline('https://provider.test', { signal: controller.signal }, 100),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('wakes cancellation during a rate-limit wait without another send', async () => {
    const send = vi.fn(
      async () => new Response('{}', { status: 429, headers: { 'retry-after': '60' } }),
    );
    const controller = new AbortController();
    const work = captured(withRetry(send, controller.signal));
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    expect((await work).error).toMatchObject({ name: 'AbortError' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('wakes cancellation during transient backoff', async () => {
    const send = vi.fn(async () => new Response('{}', { status: 503 }));
    const controller = new AbortController();
    const work = captured(withRetry(send, controller.signal));
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    expect((await work).error).toMatchObject({ name: 'AbortError' });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('clears an idle delay and resolves its rejection on shutdown', async () => {
    const controller = new AbortController();
    const work = captured(delay(30_000, controller.signal));
    controller.abort();
    expect((await work).error).toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('gives default chat, streaming and transcription calls body deadlines', async () => {
    const fetch = vi.fn(async () => new Response(new ReadableStream()));
    vi.stubGlobal('fetch', fetch);
    const common = {
      key: 'test-only',
      byok: false,
      messages: [{ role: 'user' as const, content: 'test' }],
    };
    const answer = captured(chat(common));
    await vi.advanceTimersByTimeAsync(90_000);
    expect((await answer).error).toMatchObject({ name: 'TimeoutError' });
    const stream = captured(chatStream(common).next());
    await vi.advanceTimersByTimeAsync(90_000);
    expect((await stream).error).toMatchObject({ name: 'TimeoutError' });
    const audio = captured(
      transcribe({
        key: 'test-only',
        byok: false,
        filename: 'isolated.mp3',
        bytes: new Uint8Array([1]),
      }),
    );
    await vi.advanceTimersByTimeAsync(180_000);
    expect((await audio).error).toMatchObject({ name: 'TimeoutError' });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['chat', 'transcription'])(
    'bounds a whole %s operation across repeated slow 429 responses',
    async (kind) => {
      const wait = kind === 'chat' ? 80_000 : 160_000;
      const fetch = vi.fn(
        () =>
          new Promise<Response>((resolve) =>
            setTimeout(
              () => resolve(new Response('{}', { status: 429, headers: { 'retry-after': '1' } })),
              wait,
            ),
          ),
      );
      vi.stubGlobal('fetch', fetch);
      const work = captured<unknown>(
        kind === 'chat'
          ? chat({ key: 'test-only', byok: false, messages: [{ role: 'user', content: 'test' }] })
          : transcribe({
              key: 'test-only',
              byok: false,
              filename: 'isolated.mp3',
              bytes: new Uint8Array([1]),
            }),
      );
      await vi.advanceTimersByTimeAsync(
        kind === 'chat' ? CHAT_OPERATION_MS : TRANSCRIBE_OPERATION_BASE_MS + 60_000,
      );
      expect((await work).error).toMatchObject({ name: 'TimeoutError' });
      expect(fetch.mock.calls.length).toBeGreaterThan(3);
      // Finish the deliberately cancellation-ignoring test fetch; no further retry.
      const sends = fetch.mock.calls.length;
      await vi.advanceTimersByTimeAsync(wait);
      expect(fetch).toHaveBeenCalledTimes(sends);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
