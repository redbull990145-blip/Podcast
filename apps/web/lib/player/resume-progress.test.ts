import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountScope } from '../account';
import { api } from '../api';
import { knownResumeProgress, readResumeProgress, rememberProgress, RESUME_LOOKUP_MS } from './resume-progress';

vi.mock('../account', async () => {
  const { AccountScope } = await import('@cue/core');
  return { accountScope: new AccountScope() };
});
vi.mock('../api', () => ({ api: { getProgress: vi.fn() } }));
const record = { positionSec: 360, durationSec: 1800, completed: false, deviceId: 'phone', updatedAt: Date.now() };
const remote = { ...record, episodeId: 'ep', updatedAt: new Date(record.updatedAt).toISOString() };

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.getProgress).mockReset();
  accountScope.set('listener', true);
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => { accountScope.set(null, true); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('resume startup budget', () => {
  it('releases playback at 200ms even if the transport ignores abort', async () => {
    vi.mocked(api.getProgress).mockReturnValue(new Promise(() => {}));
    const read = readResumeProgress('ep');
    const done = vi.fn(); void read.then(done);
    await vi.advanceTimersByTimeAsync(RESUME_LOOKUP_MS - 1);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(read).resolves.toBeNull();
    expect(vi.mocked(api.getProgress).mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses a warmed resume point without another request or timer', async () => {
    vi.mocked(api.getProgress).mockResolvedValue({ progress: remote });
    await expect(readResumeProgress('ep')).resolves.toEqual(record);
    await expect(readResumeProgress('ep')).resolves.toEqual(record);
    expect(api.getProgress).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('deduplicates hover, focus and click requests', async () => {
    vi.mocked(api.getProgress).mockReturnValue(new Promise(() => {}));
    const first = readResumeProgress('ep');
    expect(readResumeProgress('ep')).toBe(first);
    expect(api.getProgress).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RESUME_LOOKUP_MS);
    await first;
  });
  it('ignores a late response after startup has chosen its position', async () => {
    let respond!: (value: { progress: typeof remote }) => void;
    vi.mocked(api.getProgress).mockReturnValueOnce(new Promise((resolve) => { respond = resolve; }));
    const read = readResumeProgress('ep');
    await vi.advanceTimersByTimeAsync(RESUME_LOOKUP_MS);
    await expect(read).resolves.toBeNull();
    respond({ progress: remote }); await Promise.resolve();
    vi.mocked(api.getProgress).mockResolvedValue({ progress: null });
    await expect(readResumeProgress('ep')).resolves.toBeNull();
    expect(api.getProgress).toHaveBeenCalledTimes(2);
  });
  it('retains local progress while offline and skips the API', async () => {
    rememberProgress('ep', record);
    vi.stubGlobal('navigator', { onLine: false });
    await expect(readResumeProgress('ep')).resolves.toEqual(record);
    expect(api.getProgress).not.toHaveBeenCalled();
  });
  it('uses stale local progress when a refresh times out', async () => {
    rememberProgress('ep', record);
    await vi.advanceTimersByTimeAsync(31_000);
    vi.mocked(api.getProgress).mockReturnValue(new Promise(() => {}));
    const read = readResumeProgress('ep');
    await vi.advanceTimersByTimeAsync(RESUME_LOOKUP_MS);
    await expect(read).resolves.toEqual(record);
  });
  it('clears private cached and in-flight progress on an account change', async () => {
    rememberProgress('local', record);
    let respond!: (value: { progress: typeof remote }) => void;
    vi.mocked(api.getProgress).mockReturnValueOnce(new Promise((resolve) => { respond = resolve; }));
    const read = readResumeProgress('ep');
    accountScope.set('next-listener');
    await expect(read).resolves.toBeNull();
    respond({ progress: remote }); await Promise.resolve();
    vi.mocked(api.getProgress).mockResolvedValue({ progress: null });
    await expect(readResumeProgress('local')).resolves.toBeNull();
    await expect(readResumeProgress('ep')).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not let an older remote read overwrite a deliberate local restart', async () => {
    let respond!: (value: { progress: typeof remote }) => void;
    vi.mocked(api.getProgress).mockReturnValue(new Promise((resolve) => { respond = resolve; }));
    const read = readResumeProgress('ep');
    const restarted = { ...record, positionSec: 0 };
    rememberProgress('ep', restarted);
    await read;
    respond({ progress: remote }); await Promise.resolve();
    await expect(readResumeProgress('ep')).resolves.toEqual(restarted);
  });
  it('keeps newer local listening when a history card still shows an older position', () => {
    rememberProgress('ep', { ...record, positionSec: 900 });
    expect(knownResumeProgress('ep', { ...record, positionSec: 100, updatedAt: record.updatedAt - 120_000 })?.positionSec).toBe(900);
  });
  it('preserves a local restart against an older history card', () => {
    rememberProgress('ep', { ...record, positionSec: 0 });
    expect(knownResumeProgress('ep', { ...record, positionSec: 600, updatedAt: record.updatedAt - 1000 })?.positionSec).toBe(0);
  });
  it('uses the further concurrent position and honors a later remote session', () => {
    rememberProgress('ep', record);
    expect(knownResumeProgress('ep', { ...record, positionSec: 600, updatedAt: record.updatedAt + 1000 })?.positionSec).toBe(600);
    expect(knownResumeProgress('ep', { ...record, positionSec: 100, updatedAt: record.updatedAt + 120_000 })?.positionSec).toBe(100);
  });
  it('does not read private progress for anonymous listeners', async () => {
    accountScope.set(null);
    await expect(readResumeProgress('ep')).resolves.toBeNull();
    expect(api.getProgress).not.toHaveBeenCalled();
  });
});
