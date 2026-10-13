import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadIndex, EngineEvent, EngineListener, PlayableEpisode } from '@cue/core';
const mocks = vi.hoisted(() => ({ getProgress: vi.fn(), report: vi.fn(), local: vi.fn(), remember: vi.fn(), held: vi.fn(), online: vi.fn(), downloads: vi.fn(), engine: null as { loaded: { url: string; position: number }[]; position: number; emit: (event: EngineEvent) => void } | null }));
vi.mock('@/lib/api', () => ({ api: { getProgress: mocks.getProgress, reportProgress: mocks.report } }));
vi.mock('@/lib/auth-token', () => ({ hasOnlineSessionVerification: () => true }));
vi.mock('@/lib/connectivity', () => ({ isOnline: mocks.online }));
vi.mock('@/lib/downloads/store', () => ({ currentDownloads: mocks.downloads, subscribeDownloads: () => () => undefined }));
vi.mock('@/lib/sync/outbox', () => ({ clearHeldProgress: vi.fn(), holdProgress: mocks.held, rememberProgress: mocks.remember, localProgress: mocks.local }));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove: vi.fn() }) } }));
vi.mock('expo-audio', () => ({ requestNotificationPermissionsAsync: async () => undefined }));
vi.mock('expo-secure-store', () => ({ getItem: () => 'synthetic-device', setItem: vi.fn() }));
vi.mock('./preferences', () => ({ readPreferences: () => ({ rate: 1, skipBackSec: 15, skipForwardSec: 30 }), writePreferences: vi.fn() }));
vi.mock('./native-engine', () => ({ NativeAudioEngine: class {
  loaded: { url: string; position: number }[] = []; position = 0; listeners = new Set<EngineListener>();
  nativePlayer = { setActiveForLockScreen: vi.fn() };
  constructor() { mocks.engine = this; }
  async load(url: string, position: number) { this.loaded.push({ url, position }); this.position = position; }
  async play() { this.emit({ type: 'playing' }); }
  pause() { this.emit({ type: 'paused' }); }
  cancelLoad() {} setRate() {} setVolume() {} destroy() {}
  getPosition() { return this.position; }
  seek(position: number) { this.position = position; }
  subscribe(listener: EngineListener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event: EngineEvent) { for (const listener of this.listeners) listener(event); }
} }));
const episode = (id: string): PlayableEpisode => ({ id, podcastId: 'p', title: id, podcastTitle: 'p', audioUrl: `https://public.test/${id}.mp3`, durationSec: 300, artworkUrl: null });
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(100_000); mocks.getProgress.mockReset(); mocks.report.mockReset().mockResolvedValue({}); mocks.local.mockReset().mockReturnValue(null); mocks.remember.mockReset(); mocks.held.mockReset(); mocks.online.mockReset().mockReturnValue(true); mocks.downloads.mockReset().mockReturnValue({}); });
afterEach(() => vi.useRealTimers());
async function setup() { const { accountScope } = await import('../account'); const store = await import('./store'); accountScope.set('A'); return { accountScope, ...store }; }
describe('native progress adapter', () => {
  it('plays a downloaded file and local snapshot without a lookup when known offline', async () => {
    const s = await setup(); mocks.online.mockReturnValue(false);
    mocks.local.mockReturnValue({ episodeId: 'a', positionSec: 45, durationSec: 300, completed: false, deviceId: 'synthetic-device', observedAt: 99_000 });
    mocks.downloads.mockReturnValue({ a: { ...episode('a'), episodeId: 'a', fileUri: 'file:///audio/a.mp3', artworkUri: null, status: 'complete', bytesWritten: 100, bytesTotal: 100, error: null, requestedAt: 0, completedAt: 99_000 } } satisfies DownloadIndex);
    mocks.getProgress.mockImplementation(() => new Promise(() => undefined));
    const pending = s.playerActions.play(episode('a'));
    await Promise.resolve();
    expect(mocks.getProgress).not.toHaveBeenCalled();
    await pending;
    expect(mocks.engine!.loaded).toEqual([{ url: 'file:///audio/a.mp3', position: 40 }]);
  });
  it('aborts a hung online resume lookup at the deadline and plays the local snapshot', async () => {
    const s = await setup(); let signal: AbortSignal | undefined;
    mocks.local.mockReturnValue({ episodeId: 'a', positionSec: 45, durationSec: 300, completed: false, deviceId: 'synthetic-device', observedAt: 99_000 });
    mocks.getProgress.mockImplementation((_id: string, options?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      signal = options?.signal;
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    let settled = false;
    const pending = s.playerActions.play(episode('a')).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(settled).toBe(true);
    await pending;
    expect(mocks.engine!.loaded[0]?.position).toBe(40);
  });
  it('bounds a lookup even when the transport ignores abort', async () => {
    const s = await setup(); let finish!: (result: { progress: null }) => void;
    mocks.getProgress.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let settled = false;
    const pending = s.playerActions.play(episode('a')).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(settled).toBe(true);
    await pending;
    expect(mocks.engine!.loaded).toEqual([{ url: 'https://public.test/a.mp3', position: 0 }]);
    finish({ progress: null }); await Promise.resolve(); await Promise.resolve();
    expect(mocks.engine!.loaded).toHaveLength(1);
  });
  it('does not revive a timed-out play after account A-B-A or a newer play intent', async () => {
    const s = await setup(); mocks.getProgress.mockImplementation(() => new Promise(() => undefined));
    const departed = s.playerActions.play(episode('a'));
    s.accountScope.set('B'); s.accountScope.set('A');
    await vi.advanceTimersByTimeAsync(15_000); await departed;
    expect(mocks.engine!.loaded).toHaveLength(0);
    const superseded = s.playerActions.play(episode('b'));
    await s.playerActions.playAt(episode('c'), 90);
    await vi.advanceTimersByTimeAsync(15_000); await superseded;
    expect(mocks.engine!.loaded).toEqual([{ url: 'https://public.test/c.mp3', position: 90 }]);
  });
  it('delivers periodic and forced short-session/departure writes under the right episode', async () => {
    const s = await setup(); mocks.getProgress.mockResolvedValue({ progress: null });
    await s.playerActions.play(episode('a')); mocks.engine!.position = 42; mocks.engine!.emit({ type: 'position', positionSec: 42 });
    mocks.engine!.position = 45; s.playerActions.pause(); await s.playerActions.play(episode('b'));
    expect(mocks.report.mock.calls.map((call) => [call[0], call[1].positionSec])).toEqual([['a', 42], ['a', 45], ['a', 45]]);
    await Promise.resolve(); await Promise.resolve();
  });
  it('rejects an older resume lookup and a paused pending selection', async () => {
    const s = await setup(); const resolvers: ((result: { progress: null }) => void)[] = [];
    mocks.getProgress.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const first = s.playerActions.play(episode('a')); const second = s.playerActions.play(episode('b'));
    resolvers[1]!({ progress: null }); await second; resolvers[0]!({ progress: null }); await first;
    expect(mocks.engine!.loaded.map((load) => load.url)).toEqual(['https://public.test/b.mp3']);
    const pending = s.playerActions.play(episode('c')); s.playerActions.pause(); resolvers[2]!({ progress: null }); await pending;
    expect(mocks.engine!.loaded).toHaveLength(1);
  });
  it('resumes the account-owned local snapshot after a network lookup fails', async () => {
    const s = await setup(); mocks.local.mockReturnValue({ episodeId: 'a', positionSec: 45, durationSec: 300, completed: false, deviceId: 'synthetic-device', observedAt: 99_000 });
    mocks.getProgress.mockRejectedValue(new Error('offline')); await s.playerActions.play(episode('a'));
    expect(mocks.engine!.loaded[0]?.position).toBe(40);
  });
});
