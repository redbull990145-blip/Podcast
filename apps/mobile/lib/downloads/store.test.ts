import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayableEpisode } from '@cue/core';
const mocks = vi.hoisted(() => ({ transfers: [] as { resolve: (saved: unknown) => void; reject: (error: unknown) => void; options: { signal: AbortSignal; onProgress: (bytes: number, total: number) => void } }[], deleted: vi.fn() }));
vi.mock('./files', () => ({ readIndex: () => ({}), reconcileWithDisk: (index: unknown) => index, writeIndex: vi.fn(), deleteFiles: mocks.deleted,
  downloadEpisode: (_record: unknown, options: typeof mocks.transfers[number]['options']) => new Promise((resolve, reject) => { mocks.transfers.push({ resolve, reject, options }); }),
}));
beforeEach(() => { vi.resetModules(); mocks.transfers.length = 0; mocks.deleted.mockReset(); });
const episode: PlayableEpisode = { id: 'e', podcastId: 'p', title: 'e', podcastTitle: 'p', audioUrl: 'https://public.test/e.mp3', durationSec: 300, artworkUrl: null };
const saved = (fileUri: string) => ({ fileUri, artworkUri: null, bytes: 100 });
describe('download transfer ownership', () => {
  it('ignores stale progress/completion/finalizer after cancel and immediate resave', async () => {
    const s = await import('./store'); s.downloadActions.save(episode);
    const old = mocks.transfers[0]!; s.downloadActions.remove('e'); s.downloadActions.save(episode);
    const current = mocks.transfers[1]!;
    expect(old.options.signal.aborted).toBe(true);
    old.options.onProgress(90, 100); old.resolve(saved('file:///old'));
    await Promise.resolve(); await Promise.resolve();
    expect(s.currentDownloads()['e']).toMatchObject({ status: 'downloading', bytesWritten: 0, fileUri: null });
    s.downloadActions.remove('e'); expect(current.options.signal.aborted).toBe(true);
    current.resolve(saved('file:///current')); await Promise.resolve(); await Promise.resolve();
    expect(s.currentDownloads()['e']).toBeUndefined();
  });
  it('keeps a replacement live after the old transfer fails', async () => {
    const s = await import('./store'); s.downloadActions.save(episode); const old = mocks.transfers[0]!;
    s.downloadActions.remove('e'); s.downloadActions.save(episode); const current = mocks.transfers[1]!;
    old.reject(new Error('old failure')); await Promise.resolve(); await Promise.resolve();
    expect(s.currentDownloads()['e']?.status).toBe('downloading');
    current.resolve(saved('file:///replacement')); await Promise.resolve(); await Promise.resolve();
    expect(s.currentDownloads()['e']).toMatchObject({ status: 'complete', fileUri: 'file:///replacement' });
  });
});
