import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock('../api', () => ({ api: { reportProgress: mocks.report } }));
const entry = (observedAt: number) => ({ episodeId: 'e', positionSec: observedAt, durationSec: 300, completed: false, deviceId: 'browser', observedAt });
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); mocks.report.mockReset(); });
afterEach(() => { vi.useRealTimers(); });
async function setup() {
  const { accountScope } = await import('../account');
  const progress = await import('./progress-sync');
  accountScope.set('A'); return { accountScope, ...progress };
}
describe('web progress recovery', () => {
  it('retains a failed final position and retries without a later playback tick', async () => {
    const s = await setup(); mocks.report.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
    s.holdWebProgress(entry(42)); await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.report).toHaveBeenCalledTimes(2);
    expect(mocks.report.mock.calls[1]![1]).toMatchObject({ positionSec: 42, observedAt: 42 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('serializes and coalesces newer observations during a slow write', async () => {
    const s = await setup(); let finish!: () => void;
    mocks.report.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue({});
    s.holdWebProgress(entry(40)); s.holdWebProgress(entry(50)); s.holdWebProgress(entry(60));
    expect(mocks.report).toHaveBeenCalledTimes(1); finish(); await s.flushWebProgress(); await Promise.resolve();
    expect(mocks.report.mock.calls.map((call) => call[1].observedAt)).toEqual([40, 60]);
  });
  it('prevents A-B-A late responses and timers from draining another generation', async () => {
    const s = await setup(); let fail!: (error: Error) => void;
    mocks.report.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; })).mockResolvedValue({});
    s.holdWebProgress(entry(40)); s.accountScope.set('B'); s.accountScope.set('A');
    s.holdWebProgress(entry(60)); fail(new Error('old failure')); await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.report.mock.calls.map((call) => call[1].observedAt)).toEqual([40, 60]);
  });
  it('bounds automatic retries and aborts stalled delivery', async () => {
    const s = await setup(); mocks.report.mockImplementation((_id, _body, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })), { once: true });
    }));
    s.holdWebProgress(entry(42)); await vi.advanceTimersByTimeAsync(70_000);
    expect(mocks.report).toHaveBeenCalledTimes(4); expect(vi.getTimerCount()).toBe(0);
  });
});
