import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadRecord } from '@cue/core';
const mocks = vi.hoisted(() => ({ disk: new Map<string, number>(), tasks: [] as { url: string; destination: { uri: string }; signal?: AbortSignal; progress?: (p: { bytesWritten: number; totalBytes: number }) => void; resolve: (file: unknown) => void; reject: (error: Error) => void }[] }));
vi.mock('expo-file-system', () => {
  class Directory {
    uri: string; exists = true;
    constructor(parent: string | { uri: string }, name: string) { this.uri = `${typeof parent === 'string' ? parent : parent.uri}/${name}`; }
    create() {}
    list() { return [...mocks.disk.keys()].filter((uri) => uri.startsWith(`${this.uri}/`)).map((uri) => new File(uri)); }
  }
  class File {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) { this.uri = `${typeof parent === 'string' ? parent : parent.uri}${name ? `/${name}` : ''}`; }
    get name() { return this.uri.split('/').at(-1)!; }
    get exists() { return mocks.disk.has(this.uri); }
    get size() { return mocks.disk.get(this.uri) ?? 0; }
    delete() { mocks.disk.delete(this.uri); }
    move(destination: File) { const bytes = this.size; this.delete(); this.uri = destination.uri; mocks.disk.set(this.uri, bytes); }
    textSync() { return '{}'; }
    write() {}
    static createDownloadTask(url: string, destination: File, options: { signal?: AbortSignal; onProgress?: (p: { bytesWritten: number; totalBytes: number }) => void }) {
      return { downloadAsync: () => new Promise((resolve, reject) => mocks.tasks.push({ url, destination, signal: options.signal, progress: options.onProgress, resolve, reject })) };
    }
  }
  return { Paths: { document: 'file:///document' }, Directory, File };
});
const record = (artworkUrl: string | null = null): DownloadRecord => ({ episodeId: 'e', podcastId: 'p', title: 'e', podcastTitle: 'p', audioUrl: 'https://public.test/e.mp3', artworkUrl, durationSec: 300, accentColor: null, fileUri: null, artworkUri: null, status: 'downloading', bytesWritten: 0, bytesTotal: -1, error: null, requestedAt: 1, completedAt: null });
beforeEach(() => { vi.resetModules(); mocks.disk.clear(); mocks.tasks.length = 0; });
afterEach(() => { vi.useRealTimers(); });
async function finish(index: number, bytes: number, total = bytes) {
  const task = mocks.tasks[index]!; const { File } = await import('expo-file-system');
  mocks.disk.set(task.destination.uri, bytes); task.progress?.({ bytesWritten: bytes, totalBytes: total });
  task.resolve(new File(task.destination.uri)); await Promise.resolve(); await Promise.resolve();
}
describe('download files', () => {
  it('isolates replacement paths and removes a late cancelled audio file', async () => {
    const s = await import('./files'); const old = new AbortController();
    const first = s.downloadEpisode(record(), { signal: old.signal, onProgress: vi.fn() });
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' }); old.abort();
    const second = s.downloadEpisode(record(), { signal: new AbortController().signal, onProgress: vi.fn() });
    expect(mocks.tasks[0]!.destination.uri).not.toBe(mocks.tasks[1]!.destination.uri);
    await finish(0, 100); await rejected; await finish(1, 100);
    const saved = await second; expect(saved.bytes).toBe(100); expect(mocks.disk.size).toBe(1); expect(mocks.disk.has(saved.fileUri)).toBe(true);
  });
  it('rejects partial audio and reconciles truncated completed files', async () => {
    const s = await import('./files'); const pending = s.downloadEpisode(record(), { signal: new AbortController().signal, onProgress: vi.fn() });
    const rejected = expect(pending).rejects.toThrow('stopped before'); await finish(0, 40, 100); await rejected; expect(mocks.disk.size).toBe(0);
    const fileUri = 'file:///document/downloads/audio/e.mp3'; mocks.disk.set(fileUri, 40);
    expect(s.reconcileWithDisk({ e: { ...record(), status: 'complete', fileUri, bytesWritten: 100 } })).toEqual({});
  });
  it('cancels artwork, cleans both files and bounds an artwork outage', async () => {
    vi.useFakeTimers(); const s = await import('./files'); const controller = new AbortController();
    const pending = s.downloadEpisode(record('https://public.test/art.jpg'), { signal: controller.signal, onProgress: vi.fn() });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); await finish(0, 100);
    expect(mocks.tasks).toHaveLength(2); controller.abort(); expect(mocks.tasks[1]!.signal?.aborted).toBe(true);
    await finish(1, 20); await rejected; expect(mocks.disk.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    const next = s.downloadEpisode(record('https://public.test/art.jpg'), { signal: new AbortController().signal, onProgress: vi.fn() });
    await finish(2, 100); await vi.advanceTimersByTimeAsync(30_000); expect(mocks.tasks[3]!.signal?.aborted).toBe(true);
    mocks.tasks[3]!.reject(new Error('Artwork timeout')); const saved = await next;
    expect(saved.artworkUri).toBeNull(); expect(saved.bytes).toBe(100);
  });
  it('cleans only abandoned partials and refuses files outside its own directory', async () => {
    const s = await import('./files');
    mocks.disk.set('file:///document/downloads/audio/e-old.part', 40);
    mocks.disk.set('file:///document/unrelated.part', 12); mocks.disk.set('file:///document/downloads/audio/e.mp3', 100);
    s.readIndex(); expect(mocks.disk.has('file:///document/downloads/audio/e-old.part')).toBe(false);
    expect(mocks.disk.has('file:///document/unrelated.part')).toBe(true);
    s.deleteFiles({ ...record(), fileUri: 'file:///document/unrelated.part' });
    expect(mocks.disk.has('file:///document/unrelated.part')).toBe(true);
  });
});
