import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('server catalogue requests', () => {
  it.each([undefined, 'synthetic-internal-token'])('keeps cached reads anonymous with or without an internal token', async (token) => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.com/');
    vi.stubEnv('INTERNAL_API_TOKEN', token);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { items: [], nextCursor: null } })));
    vi.stubGlobal('fetch', fetchMock);
    const { catalogue } = await import('./catalogue');

    await catalogue.getPodcasts({ limit: 18 });

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/podcasts?limit=18');
    expect(options.credentials).toBe('omit');
    expect(options.next).toEqual({ revalidate: 300 });
    const headers = new Headers(options.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-cue-account-id')).toBeNull();
    expect(headers.get('x-cue-internal')).toBe(token ?? null);
  });
});
