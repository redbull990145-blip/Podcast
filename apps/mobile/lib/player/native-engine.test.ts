import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listeners: new Set<(status: unknown) => void>(), seek: vi.fn() }));
vi.mock('expo-audio', () => ({
  setAudioModeAsync: async () => undefined,
  createAudioPlayer: () => ({ isLoaded: false, replace: vi.fn(), seekTo: mocks.seek,
    addListener: (_name: string, listener: (status: unknown) => void) => { mocks.listeners.add(listener); return { remove: () => mocks.listeners.delete(listener) }; },
    play: vi.fn(), pause: vi.fn(), remove: vi.fn(), clearLockScreenControls: vi.fn(),
  }),
}));
beforeEach(() => { vi.resetModules(); mocks.listeners.clear(); mocks.seek.mockReset(); });
afterEach(() => vi.useRealTimers());
describe('cancelled native resume seek', () => {
  it('rejects a stalled resume without seeking an unloaded source', async () => {
    vi.useFakeTimers(); const { NativeAudioEngine } = await import('./native-engine'); const engine = new NativeAudioEngine();
    const pending = engine.load('https://publisher.test/stalled.mp3', 60); const rejected = expect(pending).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(15_000); await rejected; expect(mocks.seek).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0); engine.destroy();
  });
  it('ignores late status events from a replaced source subscriber', async () => {
    const { NativeAudioEngine } = await import('./native-engine'); const engine = new NativeAudioEngine();
    await engine.load('https://publisher.test/A.mp3', 0); const old = [...mocks.listeners];
    await engine.load('https://publisher.test/B.mp3', 0); const listener = vi.fn(); engine.subscribe(listener);
    for (const callback of old) callback({ isLoaded: true, error: null, duration: 100, currentTime: 99, playing: true, isBuffering: false, didJustFinish: true });
    expect(listener).not.toHaveBeenCalled(); engine.destroy();
  });
  it('never applies a departed account resume position to a replacement source', async () => {
    const { NativeAudioEngine } = await import('./native-engine');
    const engine = new NativeAudioEngine();
    const old = engine.load('https://publisher.test/A.mp3', 60);
    const oldListeners = [...mocks.listeners];
    engine.cancelLoad(); await engine.load('https://publisher.test/B.mp3', 0);
    for (const listener of oldListeners) listener({ isLoaded: true, error: null, duration: 100, currentTime: 0, playing: false, isBuffering: false, didJustFinish: false });
    await old; expect(mocks.seek).not.toHaveBeenCalled(); engine.destroy();
  });
});
