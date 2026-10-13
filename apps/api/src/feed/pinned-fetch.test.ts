import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { fetchChecked, pinnedLookup } from './pinned-fetch.ts';
import type { UrlCheck } from './url-guard.ts';
import { fetchFeed } from './fetch.ts';

const checked = (url: string, addresses: string[]): Extract<UrlCheck, { allowed: true }> => ({ allowed: true, url: new URL(url), addresses });
describe('validated socket lookup', () => {
  it('cancels an oversized feed before returning its size rejection', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-length': '999999999' } });
    const outcome = await fetchFeed('http://8.8.8.8/feed', { fetchImpl: (async () => response) as typeof fetch });
    expect(outcome).toMatchObject({ status: 'error', retryable: false });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('returns only the checked address for an all-address lookup', () => {
    const callback = vi.fn();
    pinnedLookup(checked('https://publisher.example/audio', ['8.8.8.8', '2606:4700:4700::1111']))('publisher.example', { all: true, family: 4 }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
  });
  it('refuses a different host or a family with no checked addresses', () => {
    const lookup = pinnedLookup(checked('https://publisher.example/audio', ['8.8.8.8']));
    for (const [host, family] of [['other.example', 4], ['publisher.example', 6]] as const) {
      const callback = vi.fn(); lookup(host, { family }, callback);
      expect(callback.mock.calls[0]?.[0]).toMatchObject({ code: 'ENOTFOUND' });
    }
  });
  it('connects to the pinned address while preserving Host, without resolving the URL host', async () => {
    // A synthetic validated snapshot targets only this local test server.
    // Production callers obtain snapshots exclusively from checkUrl.
    const server = createServer((request, response) => { response.end(request.headers.host); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as { port: number };
    try {
      const response = await fetchChecked(checked(`http://does-not-exist.invalid:${address.port}/feed`, ['127.0.0.1']), { signal: AbortSignal.timeout(2000) });
      expect(await response.text()).toBe(`does-not-exist.invalid:${address.port}`);
    } finally { server.closeAllConnections(); server.close(); }
  });
});
