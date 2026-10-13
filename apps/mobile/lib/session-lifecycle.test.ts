import type { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ state: null as ((value: string) => void) | null, reconnect: null as (() => void) | null, online: true, remove: vi.fn(), unsubscribe: vi.fn(), flush: vi.fn() }));
vi.mock('react-native', () => ({ AppState: { addEventListener: (_name: string, callback: (value: string) => void) => { mocks.state = callback; return { remove: mocks.remove }; } } }));
vi.mock('./connectivity', () => ({ isOnline: () => mocks.online, subscribeConnectivity: (callback: () => void) => { mocks.reconnect = callback; return mocks.unsubscribe; } }));
vi.mock('./sync/outbox', () => ({ flushProgress: mocks.flush }));
vi.mock('./auth-token', () => ({ requireSessionRevalidation: vi.fn() }));
beforeEach(() => { vi.resetModules(); mocks.online = true; mocks.flush.mockReset(); mocks.remove.mockReset(); mocks.unsubscribe.mockReset(); });
describe('mobile session resume', () => {
  it('shares subscriptions and verifies session before draining recovered progress', async () => {
    const { watchSessionLifecycle } = await import('./session-lifecycle'); let finish!: () => void;
    const invalidateQueries = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const client = { invalidateQueries } as unknown as QueryClient; const stopA = watchSessionLifecycle(client); const stopB = watchSessionLifecycle(client);
    mocks.state?.('active'); expect(invalidateQueries).toHaveBeenCalledOnce(); expect(mocks.flush).not.toHaveBeenCalled();
    finish(); await Promise.resolve(); await Promise.resolve(); expect(mocks.flush).toHaveBeenCalledOnce();
    stopA(); expect(mocks.remove).not.toHaveBeenCalled(); stopB(); expect(mocks.remove).toHaveBeenCalledOnce(); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
  it('waits offline and retries identity on reconnect', async () => {
    const { watchSessionLifecycle } = await import('./session-lifecycle'); const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const stop = watchSessionLifecycle({ invalidateQueries } as unknown as QueryClient);
    mocks.online = false; mocks.state?.('active'); expect(invalidateQueries).not.toHaveBeenCalled();
    mocks.online = true; mocks.reconnect?.(); await Promise.resolve(); await Promise.resolve();
    expect(invalidateQueries).toHaveBeenCalledOnce(); expect(mocks.flush).toHaveBeenCalledOnce(); stop();
  });
});
