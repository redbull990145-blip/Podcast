import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createClient } from './client.ts';
import { queryKeys } from './keys.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(fetchImpl: typeof fetch, baseUrl = 'https://api.test') {
  return createClient({ baseUrl, fetchImpl });
}

describe('account boundaries', () => {
  it('forwards cancellation for session verification and preserves server expiry metadata', async () => {
    const controller = new AbortController(); const sessionExpiresAt = '2030-01-01T00:00:00.000Z';
    const fetchImpl = mockFetch({ ok: true, data: { user: null, sessionExpiresAt } });
    expect(await clientWith(fetchImpl as unknown as typeof fetch).getMe(controller.signal)).toEqual({ user: null, sessionExpiresAt });
    expect(fetchImpl.mock.calls[0]![1]?.signal).toBe(controller.signal);
  });
  it('forwards cancellation of an account-owned progress write', async () => {
    const controller = new AbortController();
    const fetchImpl = mockFetch({ ok: true, data: { progress: {}, superseded: false } });
    const client = clientWith(fetchImpl as unknown as typeof fetch);
    await client.reportProgress('episode', { positionSec: 30, durationSec: 90, completed: false, deviceId: 'test', observedAt: 1 }, controller.signal);
    expect(fetchImpl.mock.calls[0]![1]?.signal).toBe(controller.signal);
  });
  it('sends the verified account intent and permits /me to discover a cookie change', async () => {
    const fetchImpl = mockFetch({ ok: true, data: { user: { id: 'B' } } });
    const client = createClient({ baseUrl: 'https://api.test', getAccountId: () => 'A', fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.clearQueue();
    expect(fetchImpl.mock.calls[0]![1]?.headers).toMatchObject({ 'X-Cue-Account-Id': 'A' });
    const changed = jsonResponse({ ok: true, data: { user: { id: 'B' } } }); changed.headers.set('X-Cue-Account-Id', 'B');
    fetchImpl.mockResolvedValueOnce(changed);
    expect(await client.getMe()).toEqual({ user: { id: 'B' } });
    expect(fetchImpl.mock.calls[1]![1]?.headers).not.toHaveProperty('X-Cue-Account-Id');
  });
  it('rejects a delayed response after account A becomes account B', async () => {
    let generation = 1;
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const client = createClient({ baseUrl: 'https://api.test', getSessionGeneration: () => generation, fetchImpl: (() => pending) as typeof fetch });
    const request = client.getQueue();
    await Promise.resolve();
    generation += 1;
    finish(jsonResponse({ ok: true, data: { items: ['A-private'] } }));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('does not send a write when identity changes while reading the token', async () => {
    let generation = 1;
    const fetchImpl = vi.fn();
    const client = createClient({ baseUrl: 'https://api.test', getSessionGeneration: () => generation,
      getAuthToken: async () => { generation += 1; return 'old-token'; }, fetchImpl });
    await expect(client.clearQueue()).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('revokes the explicitly captured native token after local credentials are cleared', async () => {
    const fetchImpl = mockFetch({ success: true });
    const client = createClient({ baseUrl: 'https://api.test', getAuthToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.signOut('departing-token');
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', headers: { authorization: 'Bearer departing-token' } });
  });
  it('rejects a private response from a different verified account', async () => {
    const response = jsonResponse({ ok: true, data: { items: ['B-private'] } });
    response.headers.set('X-Cue-Account-Id', 'B');
    const onUnauthorized = vi.fn();
    const client = createClient({ baseUrl: 'https://api.test', getAccountId: () => 'A', onUnauthorized, fetchImpl: (async () => response) as typeof fetch });
    await expect(client.getQueue()).rejects.toMatchObject({ name: 'AbortError' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
  it('applies the account fence to raw banner uploads', async () => {
    let generation = 1;
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const fetchImpl = vi.fn(() => pending);
    const client = createClient({ baseUrl: 'https://api.test', getSessionGeneration: () => generation, fetchImpl: fetchImpl as typeof fetch });
    const file = new Blob(['image'], { type: 'image/png' });
    const request = client.uploadPlaylistBanner('p', file);
    await Promise.resolve(); expect(fetchImpl.mock.calls).toHaveLength(1);
    generation += 1; finish(jsonResponse({ ok: true, data: { playlist: {} } }));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('does not deliver streaming tokens from a departed account', async () => {
    let generation = 1;
    const onToken = vi.fn();
    const client = createClient({ baseUrl: 'https://api.test', getSessionGeneration: () => generation,
      sse: async (options) => { generation += 1; options.onFrame('event: token\ndata: {"token":"A-private"}'); } });
    await expect(client.askEpisode('e', { question: 'test', onToken })).rejects.toMatchObject({ name: 'AbortError' });
    expect(onToken).not.toHaveBeenCalled();
  });
});

/**
 * A spy with fetch's actual signature, so `mock.calls[0]` is typed as
 * `[string, RequestInit | undefined]` rather than an empty tuple.
 */
function mockFetch(body: unknown, status = 200) {
  return vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(jsonResponse(body, status)),
  );
}

describe('request building', () => {
  it('forwards progress lookup cancellation with the intended account', async () => {
    const fetchImpl = mockFetch({ ok: true, data: { progress: null } });
    const controller = new AbortController();
    const client = createClient({ baseUrl: 'https://api.test', fetchImpl: fetchImpl as unknown as typeof fetch, getAccountId: () => 'A' });
    await client.getProgress('e1', { signal: controller.signal });
    const request = fetchImpl.mock.calls[0]![1];
    expect(request?.signal).toBe(controller.signal);
    expect((request?.headers as Record<string, string>)['X-Cue-Account-Id']).toBe('A');
  });
  it('unwraps the envelope so callers see data, not the wrapper', async () => {
    const fetchImpl = mockFetch({ ok: true, data: { episode: { id: 'e1' } } });

    const result = await clientWith(fetchImpl as unknown as typeof fetch).getEpisode('e1');
    expect(result).toEqual({ episode: { id: 'e1' } });
  });

  it('omits empty query params rather than sending `?language=undefined`', async () => {
    const fetchImpl = mockFetch({ ok: true, data: { results: [] } });

    await clientWith(fetchImpl as unknown as typeof fetch).searchPodcasts('hello', {
      limit: 10,
    });

    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.searchParams.get('q')).toBe('hello');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.has('language')).toBe(false);
  });

  it('tolerates a base URL with a trailing slash', async () => {
    const fetchImpl = mockFetch({ ok: true, data: {} });

    await clientWith(fetchImpl as unknown as typeof fetch, 'https://api.test/').getEpisode('e1');

    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.test/episodes/e1');
  });

  it('sends an auth token when one is available', async () => {
    const fetchImpl = mockFetch({ ok: true, data: {} });

    const client = createClient({
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAuthToken: () => 'token-123',
    });
    await client.getEpisode('e1');

    const headers = fetchImpl.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer token-123');
  });

  it('does not send an authorization header when there is no token', async () => {
    const fetchImpl = mockFetch({ ok: true, data: {} });

    await clientWith(fetchImpl as unknown as typeof fetch).getEpisode('e1');

    const headers = fetchImpl.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers['authorization']).toBeUndefined();
  });
});

describe('error handling', () => {
  it('throws a typed error carrying the machine-readable code', async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { ok: false, error: { code: 'not_found', message: 'Podcast not found' } },
        404,
      )) as unknown as typeof fetch;

    await expect(clientWith(fetchImpl).getPodcast('missing')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
  });

  it('surfaces field errors for a form to render', async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        {
          ok: false,
          error: {
            code: 'bad_request',
            message: 'Could not read that feed',
            fields: { feedUrl: 'Publisher returned 404' },
          },
        },
        400,
      )) as unknown as typeof fetch;

    try {
      await clientWith(fetchImpl).addPodcast('https://example.com/gone.xml');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
      expect((error as ApiClientError).fields?.['feedUrl']).toBe('Publisher returned 404');
    }
  });

  it('marks only transient failures as retryable', async () => {
    // Retrying a 404 is pure latency; retrying a 429 eventually works.
    const notFound = new ApiClientError({ code: 'not_found', message: '' }, 404);
    const limited = new ApiClientError({ code: 'rate_limited', message: '' }, 429);
    const upstream = new ApiClientError({ code: 'upstream_unavailable', message: '' }, 502);

    expect(notFound.retryable).toBe(false);
    expect(limited.retryable).toBe(true);
    expect(upstream.retryable).toBe(true);
  });

  it('reports an unreachable server rather than leaking the fetch failure', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    await expect(clientWith(fetchImpl).getEpisode('e1')).rejects.toMatchObject({
      code: 'upstream_unavailable',
      status: 0,
    });
  });

  it('rethrows an abort so a cancelled search is not reported as an outage', async () => {
    // Aborts are the caller's own doing — a navigation, a new keystroke.
    const fetchImpl = (async () => {
      throw new DOMException('The operation was aborted', 'AbortError');
    }) as unknown as typeof fetch;

    await expect(clientWith(fetchImpl).getEpisode('e1')).rejects.toThrow(DOMException);
  });

  it('handles a non-JSON response without throwing a parse error at the caller', async () => {
    const fetchImpl = (async () =>
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch;

    await expect(clientWith(fetchImpl).getEpisode('e1')).rejects.toMatchObject({
      code: 'internal',
    });
  });
});

describe('queryKeys', () => {
  it('nests episodes under their podcast so one invalidation covers both', () => {
    const detail = queryKeys.podcast.detail('p1');
    const episodes = queryKeys.podcast.episodes('p1');

    expect(episodes.slice(0, detail.length)).toEqual([...detail]);
  });

  it('normalises a search term so casing and spacing share a cache entry', () => {
    expect(queryKeys.discover.search('  Startups  ')).toEqual(
      queryKeys.discover.search('startups'),
    );
  });

  it('keeps different languages in different cache entries', () => {
    expect(queryKeys.discover.search('news', 'hi')).not.toEqual(
      queryKeys.discover.search('news', 'es'),
    );
  });
});
