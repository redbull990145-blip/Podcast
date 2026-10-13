import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ saved: null as string | null, set: vi.fn(), clear: vi.fn() }));
vi.mock('expo-secure-store', () => ({ getItem: () => mocks.saved, setItemAsync: mocks.set, deleteItemAsync: mocks.clear }));
beforeEach(() => { vi.resetModules(); mocks.saved = null; mocks.set.mockReset(); mocks.clear.mockReset(); });
describe('credential persistence', () => {
  it('clears memory immediately and serializes deletion before a new sign-in write', async () => {
    const { getToken, setToken, clearToken } = await import('./auth-token');
    mocks.set.mockImplementation(async (_key: string, value: string) => { mocks.saved = value; });
    await setToken('A-token');
    let finish!: () => void;
    mocks.clear.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = () => { mocks.saved = null; resolve(); }; }));
    const logout = clearToken(); expect(getToken()).toBeNull();
    const login = setToken('B-token');
    await Promise.resolve(); await Promise.resolve(); finish();
    await Promise.all([logout, login]); expect(getToken()).toBe('B-token'); expect(mocks.saved).toBe('B-token');
  });
});
