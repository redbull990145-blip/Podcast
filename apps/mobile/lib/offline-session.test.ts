import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ saved: new Map<string, string>(), write: vi.fn(), online: true, me: vi.fn(), query: null as null | { queryFn: () => Promise<unknown> } }));
vi.mock('expo-secure-store', () => ({ getItem: (key: string) => mocks.saved.get(key) ?? null,
  setItemAsync: mocks.write, deleteItemAsync: async (key: string) => { mocks.saved.delete(key); } }));
vi.mock('./account', async () => { const { AccountScope } = await import('@cue/core'); return { accountScope: new AccountScope(), bindAccountCache: vi.fn() }; });
vi.mock('react', () => ({ useEffect: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}), useQuery: (options: typeof mocks.query) => { mocks.query = options; return { data: undefined, isPending: false }; } }));
vi.mock('./api', () => ({ api: { getMe: mocks.me } }));
vi.mock('./connectivity', () => ({ isOnline: () => mocks.online }));
vi.mock('./player/store', () => ({ resetQueue: vi.fn(), setSyncState: vi.fn() }));
vi.mock('./session-lifecycle', () => ({ watchSessionLifecycle: vi.fn() }));

const user = (id = 'A') => ({ id, email: `${id}@synthetic.invalid`, name: id, image: null });
const expires = () => new Date(Date.now() + 60_000).toISOString();
beforeEach(() => {
  vi.resetModules(); mocks.saved.clear(); mocks.online = true; mocks.me.mockReset(); mocks.query = null;
  mocks.write.mockReset().mockImplementation(async (key: string, value: string) => { mocks.saved.set(key, value); });
});
afterEach(() => { vi.useRealTimers(); });
async function setup() {
  const auth = await import('./auth-token'); const { accountScope } = await import('./account');
  return { ...auth, accountScope };
}
async function query() { const { useSession } = await import('./session'); useSession(); return mocks.query!.queryFn(); }
async function drain() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

describe('server-verified offline identity', () => {
  it('bounds an unknown network startup lookup and retains verified offline identity after its deadline', async () => {
    const s = await setup(); const { useSession } = await import('./session');
    vi.useFakeTimers(); await s.setToken('synthetic-A');
    await s.rememberVerifiedSession({ user: user(), sessionExpiresAt: expires() }, s.getToken(), s.accountScope.snapshot());
    s.requireSessionRevalidation();
    mocks.me.mockImplementation((signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('Synthetic timeout'), { name: 'AbortError' })), { once: true });
    }));
    useSession(); const request = mocks.query!.queryFn();
    expect(mocks.me).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(15_000);
    expect(await request).toMatchObject({ user: user() }); expect(s.hasOnlineSessionVerification()).toBe(false);
    expect(vi.getTimerCount()).toBe(1); await s.clearToken(); expect(vi.getTimerCount()).toBe(0);
  });
  it('restores a cold offline session only from an exact credential and unexpired server identity', async () => {
    const s = await setup(); await s.setToken('synthetic-A');
    await s.rememberVerifiedSession({ user: user(), sessionExpiresAt: expires() }, s.getToken(), s.accountScope.snapshot());
    expect(s.hasOnlineSessionVerification()).toBe(true);
    vi.resetModules(); mocks.online = false; const restarted = await setup();
    expect(await query()).toMatchObject({ user: user() }); expect(mocks.me).not.toHaveBeenCalled();
    expect(restarted.accountScope.snapshot().accountId).toBe('A'); expect(restarted.hasOnlineSessionVerification()).toBe(false);
    await restarted.clearToken();
  });
  it('clears expired persisted identity and credential across restart, and never restores a bare or mismatched token', async () => {
    mocks.saved.set('cue.session-token', 'synthetic-A');
    mocks.saved.set('cue.verified-session', JSON.stringify({ token: 'synthetic-A', user: user(), expiresAt: new Date(Date.now() - 1).toISOString() }));
    const s = await setup(); expect(s.readOfflineSession()).toBeNull(); expect(s.getToken()).toBeNull();
    await drain(); expect(mocks.saved.has('cue.verified-session')).toBe(false);
    await s.setToken('synthetic-B'); expect(s.readOfflineSession()).toBeNull();
    mocks.saved.set('cue.verified-session', JSON.stringify({ token: 'synthetic-A', user: user(), expiresAt: expires() }));
    vi.resetModules(); const restarted = await setup(); expect(restarted.readOfflineSession()).toBeNull();
    expect(restarted.accountScope.snapshot().accountId).toBeNull(); await restarted.clearToken();
  });
  it('serializes A-B-A credential persistence and rejects both an old response and an in-flight identity save', async () => {
    const s = await setup(); await s.setToken('synthetic-A'); const oldOwner = s.accountScope.snapshot();
    let finish!: () => void;
    mocks.write.mockImplementationOnce((key: string, value: string) => new Promise<void>((resolve) => {
      finish = () => { mocks.saved.set(key, value); resolve(); };
    }));
    const saving = s.rememberVerifiedSession({ user: user(), sessionExpiresAt: expires() }, 'synthetic-A', oldOwner);
    const rejectedSave = expect(saving).rejects.toMatchObject({ name: 'AbortError' }); await drain();
    const b = s.setToken('synthetic-B'); const a = s.setToken('synthetic-A'); finish();
    await Promise.all([b, a, rejectedSave]);
    expect(mocks.saved.get('cue.session-token')).toBe('synthetic-A'); expect(mocks.saved.has('cue.verified-session')).toBe(false);
    await expect(s.rememberVerifiedSession({ user: user(), sessionExpiresAt: expires() }, 'synthetic-A', oldOwner)).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.readOfflineSession()).toBeNull(); await s.clearToken();
  });
  it('invalidates verified identity on logout, expiry and resume revalidation without trusting a transient outage', async () => {
    const s = await setup(); vi.useFakeTimers(); await s.setToken('synthetic-A');
    await s.rememberVerifiedSession({ user: user(), sessionExpiresAt: expires() }, s.getToken(), s.accountScope.snapshot());
    s.requireSessionRevalidation(); expect(s.hasOnlineSessionVerification()).toBe(false);
    mocks.me.mockRejectedValue(new TypeError('Synthetic network outage'));
    expect(await query()).toMatchObject({ user: user() }); expect(s.hasOnlineSessionVerification()).toBe(false);
    mocks.me.mockResolvedValue({ user: user(), sessionExpiresAt: expires() }); await query(); expect(s.hasOnlineSessionVerification()).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000); expect(s.getToken()).toBeNull(); expect(s.accountScope.snapshot().accountId).toBeNull();
    expect(mocks.saved.size).toBe(0);
  });
  it('clears an explicit server rejection and does not persist identity from a response without expiry metadata', async () => {
    const s = await setup(); await s.setToken('synthetic-A');
    await s.rememberVerifiedSession({ user: user(), sessionExpiresAt: null }, s.getToken(), s.accountScope.snapshot());
    expect(s.readOfflineSession()).toBeNull(); expect(mocks.saved.has('cue.verified-session')).toBe(false);
    mocks.me.mockResolvedValue({ user: null, sessionExpiresAt: null }); expect(await query()).toEqual({ user: null, sessionExpiresAt: null });
    expect(s.getToken()).toBeNull(); expect(s.accountScope.snapshot().accountId).toBeNull(); expect(mocks.saved.size).toBe(0);
  });
});
