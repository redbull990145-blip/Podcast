import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const API = 'https://api.test';
const APP = 'https://cue.test';
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const json = (data: unknown, owner?: string, status = 200) => new Response(JSON.stringify({ ok: status === 200, data }), { status, headers: { 'content-type': 'application/json', ...(owner ? { 'X-Cue-Account-Id': owner } : {}) } });

function worker() {
  let intendedOwner: string | null = null;
  const stores = new Map<string, Map<string, Response>>();
  const listeners = new Map<string, (event: unknown) => void>();
  const fetch = vi.fn<(request: Request) => Promise<Response>>();
  const key = (request: Request | string) => typeof request === 'string' ? new URL(request, APP).href : request.url;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: vi.fn(async (name: string) => stores.delete(name)),
    open: vi.fn(async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (request: Request | string, response: Response) => { store.set(key(request), response.clone()); },
        match: async (request: Request | string) => store.get(key(request))?.clone(),
        keys: async () => [...store.keys()].map((url) => new Request(url)),
        delete: async (request: Request | string) => store.delete(key(request)),
      };
    }),
  };
  const notify = vi.fn();
  runInNewContext(source, { URL, Headers, Request, Response, Date, fetch, caches, self: {
    location: new URL(`${APP}/sw.js?api=${encodeURIComponent(API)}`),
    addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
    clients: { matchAll: async () => [{ postMessage: notify }], claim: async () => undefined },
  } });
  function request(path: string, options: { navigate?: boolean; range?: boolean; audio?: boolean; owner?: string | null; authorization?: string } = {}) {
    const owner = options.owner === undefined ? intendedOwner : options.owner;
    const request = new Request(path.startsWith('http') ? path : `${API}${path}`, { credentials: 'include', headers: { ...(options.range ? { range: 'bytes=0-5' } : {}), ...(owner ? { 'X-Cue-Account-Id': owner } : {}), ...(options.authorization ? { Authorization: options.authorization } : {}) } });
    if (options.navigate) Object.defineProperty(request, 'mode', { value: 'navigate' });
    if (options.audio) Object.defineProperty(request, 'destination', { value: 'audio' });
    let response: Promise<Response> | undefined;
    listeners.get('fetch')!({ request, waitUntil: () => undefined, respondWith: (value: Promise<Response>) => { response = value; } });
    return response;
  }
  async function message() {
    let done: Promise<unknown> | undefined;
    listeners.get('message')!({ data: { type: 'purge-data' }, waitUntil: (value: Promise<unknown>) => { done = value; } });
    await done;
  }
  async function session(id: string | null, expiresAt = new Date(Date.now() + 300_000).toISOString()) {
    fetch.mockResolvedValueOnce(json({ user: id ? { id } : null, sessionExpiresAt: id ? expiresAt : null }, id ?? undefined));
    await request('/me');
    intendedOwner = id;
  }
  const offline = () => fetch.mockRejectedValue(new Error('offline'));
  return { fetch, stores, caches, notify, request, message, session, offline };
}
afterEach(() => vi.restoreAllMocks());

describe('worker account isolation', () => {
  it('fetches shared catalogue data without account credentials and can replay it across accounts', async () => {
    const w = worker(); await w.session('A');
    w.fetch.mockResolvedValueOnce(json({ categories: ['public'] }));
    await w.request('/categories', { authorization: 'Bearer private-A' });
    const request = w.fetch.mock.calls.at(-1)![0];
    expect(request.credentials).toBe('omit');
    expect(request.headers.has('Authorization')).toBe(false);
    expect(request.headers.has('X-Cue-Account-Id')).toBe(false);
    await w.session('B'); w.offline();
    expect(await (await w.request('/categories'))!.json()).toMatchObject({ data: { categories: ['public'] } });
  });

  it.each(['account-header', 'private', 'no-store'])('does not share catalogue responses marked %s', async (mark) => {
    const w = worker();
    const response = json({ categories: ['private-A'] }, mark === 'account-header' ? 'A' : undefined);
    if (mark !== 'account-header') response.headers.set('Cache-Control', mark === 'private' ? 'max-age=300, private="Cookie"' : 'public, NO-STORE');
    w.fetch.mockResolvedValueOnce(response);
    await w.request('/categories');
    await w.session('B'); w.offline();
    expect((await w.request('/categories'))!.status).toBe(503);
  });

  it('rejects a legacy shared catalogue entry that contains account metadata', async () => {
    const w = worker();
    const cache = await w.caches.open('cue-data-v6');
    await cache.put(`${API}/categories`, json({ categories: ['private-A'] }, 'A'));
    w.offline();
    expect((await w.request('/categories'))!.status).toBe(503);
  });

  it('offers offline private data only to the same verified account', async () => {
    const w = worker();
    await w.session('A');
    w.fetch.mockResolvedValueOnce(json({ items: ['A-private'] }, 'A'));
    await w.request('/me/queue');
    w.offline();
    expect(await (await w.request('/me/queue'))!.json()).toMatchObject({ data: { items: ['A-private'] } });
    await w.session('B');
    expect((await w.request('/me/queue'))!.status).toBe(503);
    expect(w.stores.has('cue-data-v6-account-A')).toBe(false);
  });
  it('invalidates private caches when an expired session returns 401', async () => {
    const w = worker(); await w.session('A');
    w.fetch.mockResolvedValueOnce(json({ items: ['A-private'] }, 'A')); await w.request('/me/queue');
    w.fetch.mockResolvedValueOnce(json(null, undefined, 401));
    expect((await w.request('/me/queue'))!.status).toBe(401);
    w.offline(); expect((await w.request('/me/queue'))!.status).toBe(503);
    expect(w.notify).toHaveBeenCalledWith({ type: 'session-invalid' });
  });
  it('does not interpret a server outage as evidence that the account expired', async () => {
    const w = worker(); await w.session('A');
    w.fetch.mockResolvedValueOnce(json({ items: ['A-private'] }, 'A')); await w.request('/me/queue');
    w.fetch.mockResolvedValueOnce(json(null, undefined, 503));
    expect((await w.request('/me/queue'))!.status).toBe(503);
    w.offline(); expect(await (await w.request('/me/queue'))!.json()).toMatchObject({ data: { items: ['A-private'] } });
    expect(w.notify).not.toHaveBeenCalled();
  });
  it('does not recreate account A caches when an old response completes after logout', async () => {
    const w = worker(); await w.session('A');
    let resolve!: (response: Response) => void;
    w.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const old = w.request('/me/queue')!;
    await Promise.resolve(); await Promise.resolve();
    await w.message(); await w.session('B');
    resolve(json({ items: ['A-private'] }, 'A')); await old;
    w.offline(); expect((await w.request('/me/queue'))!.status).toBe(503);
    expect([...w.stores.keys()].some((name) => name.endsWith('account-A'))).toBe(false);
  });
  it('keeps protected navigation fallback out of the shared shell', async () => {
    const w = worker(); await w.session('A');
    w.fetch.mockResolvedValueOnce(new Response('A-library'));
    await w.request(`${APP}/library`, { navigate: true });
    await w.session('B'); w.offline();
    expect(await (await w.request(`${APP}/library`, { navigate: true }))!.text()).toBe('Offline');
    expect(w.stores.get('cue-shell-v6')?.has(`${APP}/library`)).toBe(false);
  });
  it('never intercepts AI polling, transcripts, auth, audio or range requests', () => {
    const w = worker();
    for (const path of ['/episodes/e/ai', '/episodes/e/transcript', '/auth/get-session', '/unknown']) expect(w.request(path)).toBeUndefined();
    expect(w.request('/podcasts/p', { range: true })).toBeUndefined();
    expect(w.request('/podcasts/p', { audio: true })).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled();
  });
  it('does not give an old tab or an unowned request the current account cache', async () => {
    const w = worker(); await w.session('B');
    w.fetch.mockResolvedValueOnce(json({ items: ['B-private'] }, 'B')); await w.request('/me/queue');
    w.offline();
    expect((await w.request('/me/queue', { owner: 'A' }))!.status).toBe(503);
    expect((await w.request('/me/queue', { owner: null }))!.status).toBe(503);
    expect(await (await w.request('/me/queue'))!.json()).toMatchObject({ data: { items: ['B-private'] } });
  });
  it('never replays application HTML with account hydration or an obsolete nonce', async () => {
    const w = worker(); await w.session('A');
    for (const path of ['/', '/library', '/search', '/episode/e', '/podcast/p']) {
      w.fetch.mockResolvedValueOnce(new Response('A-private-hydration'));
      await w.request(`${APP}${path}`, { navigate: true });
    }
    w.offline();
    for (const path of ['/', '/library', '/search', '/episode/e', '/podcast/p']) {
      expect(await (await w.request(`${APP}${path}`, { navigate: true }))!.text()).toBe('Offline');
    }
  });
  it('fails private caching closed after a rejected purge even if entries remain', async () => {
    const w = worker(); await w.session('A');
    w.fetch.mockResolvedValueOnce(json({ items: ['private'] }, 'A')); await w.request('/me/queue');
    w.caches.delete.mockRejectedValueOnce(new Error('storage unavailable'));
    await w.message(); await w.session('A'); w.offline();
    expect((await w.request('/me/queue'))!.status).toBe(503);
  });
  it('does not establish a cold-start identity from existing private caches', async () => {
    const w = worker();
    const cache = await w.caches.open('cue-data-v6-account-A');
    await cache.put(`${API}/me/queue`, json({ items: ['A-private'] }, 'A'));
    w.offline();
    expect((await w.request('/me/queue', { owner: 'A' }))!.status).toBe(503);
  });
  it('keeps navigation and network assets usable when cache storage is unavailable', async () => {
    const w = worker();
    w.caches.open.mockRejectedValue(new Error('storage unavailable'));
    w.offline();
    expect((await w.request(`${APP}/library`, { navigate: true }))!.status).toBe(503);
    w.fetch.mockResolvedValueOnce(new Response('asset-bytes'));
    expect(await (await w.request(`${APP}/_next/static/chunk.js`))!.text()).toBe('asset-bytes');
  });
  it.each(['open', 'match'])('keeps public catalogue responses usable after cache %s failure', async (operation) => {
    const w = worker();
    if (operation === 'open') w.caches.open.mockRejectedValue(new Error('storage unavailable'));
    else {
      const cache = await w.caches.open('cue-data-v6');
      cache.match = async () => { throw new Error('storage unreadable'); };
      w.caches.open.mockResolvedValueOnce(cache);
    }
    w.fetch.mockResolvedValueOnce(json({ categories: ['live'] }));
    expect(await (await w.request('/categories'))!.json()).toMatchObject({ data: { categories: ['live'] } });
    expect(w.fetch).toHaveBeenCalledOnce();
  });
  it('returns a usable private network response when its cache cannot open and fails offline replay closed', async () => {
    const w = worker(); await w.session('A');
    w.caches.open.mockRejectedValue(new Error('storage unavailable'));
    w.fetch.mockResolvedValueOnce(json({ items: ['live-A'] }, 'A'));
    expect(await (await w.request('/me/queue'))!.json()).toMatchObject({ data: { items: ['live-A'] } });
    w.offline(); expect((await w.request('/me/queue'))!.status).toBe(503);
  });
  it('purges private data when the verified session expires while fully offline', async () => {
    const w = worker(); const now = Date.now();
    await w.session('A', new Date(now + 1000).toISOString());
    w.fetch.mockResolvedValueOnce(json({ items: ['A-private'] }, 'A')); await w.request('/me/queue');
    vi.spyOn(Date, 'now').mockReturnValue(now + 2000); w.offline();
    expect((await w.request('/me/queue'))!.status).toBe(503);
    expect(w.stores.has('cue-data-v6-account-A')).toBe(false);
  });
  it.each(['missing-expiry', 'malformed-json'])('fails private caching closed after %s session metadata', async (kind) => {
    const w = worker(); await w.session('A');
    w.fetch.mockResolvedValueOnce(json({ items: ['A-private'] }, 'A')); await w.request('/me/queue');
    w.fetch.mockResolvedValueOnce(kind === 'malformed-json' ? new Response('broken JSON') : json({ user: { id: 'A' } }, 'A'));
    await w.request('/me'); w.offline();
    expect((await w.request('/me/queue'))!.status).toBe(503);
  });
});
