import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ saved: '', reportProgress: vi.fn(), online: true, verified: true, reconnect: null as (() => void) | null }));
vi.mock('expo-file-system', () => ({ Paths: { document: 'test' }, File: class {
  get exists() { return Boolean(mocks.saved); }
  textSync() { return mocks.saved; }
  write(value: string) { mocks.saved = value; }
} }));
vi.mock('@/lib/api', () => ({ api: { reportProgress: mocks.reportProgress } }));
vi.mock('@/lib/auth-token', () => ({ hasOnlineSessionVerification: () => mocks.verified, requireSessionRevalidation: () => { mocks.verified = false; } }));
vi.mock('@/lib/connectivity', () => ({ isOnline: () => mocks.online, subscribeConnectivity: (callback: () => void) => { mocks.reconnect = callback; return () => undefined; } }));

const entry = (episodeId: string) => ({ episodeId, positionSec: 45, durationSec: 100, completed: false, deviceId: 'test', observedAt: 1000 });
beforeEach(() => { vi.resetModules(); mocks.saved = ''; mocks.reportProgress.mockReset(); mocks.online = true; mocks.verified = true; mocks.reconnect = null; });
async function setup() {
  const { accountScope } = await import('../account');
  const outbox = await import('./outbox');
  return { accountScope, ...outbox };
}
describe('native progress ownership', () => {
  it('holds a cold restart outbox until identity is revalidated and stops subsequent uploads when revalidation becomes necessary', async () => {
    mocks.saved = JSON.stringify({ accountId: 'A', entries: [entry('first'), entry('second')] });
    const s = await setup(); s.accountScope.set('A'); mocks.verified = false;
    await s.flushProgress(); expect(mocks.reportProgress).not.toHaveBeenCalled(); expect(s.heldProgressCount()).toBe(2);
    mocks.verified = true; mocks.reportProgress.mockImplementationOnce(async () => { mocks.verified = false; });
    await s.flushProgress(); expect(mocks.reportProgress.mock.calls.map((call) => call[0])).toEqual(['first']); expect(s.heldProgressCount()).toBe(1);
    mocks.verified = true; await s.flushProgress(); expect(mocks.reportProgress.mock.calls.map((call) => call[0])).toEqual(['first', 'second']);
  });
  it('keeps a delivered local snapshot through restart under its verified account', async () => {
    const s = await setup(); s.accountScope.set('A'); s.rememberProgress(entry('saved'), s.accountScope.snapshot());
    expect(s.heldProgressCount()).toBe(0);
    vi.resetModules(); const restarted = await setup(); restarted.accountScope.set('A');
    expect(restarted.localProgress('saved')).toMatchObject({ positionSec: 45 });
    restarted.accountScope.set('B'); expect(restarted.localProgress('saved')).toBeNull();
  });
  it('watches reconnect after restart even when the initial flush is offline', async () => {
    mocks.saved = JSON.stringify({ accountId: 'A', entries: [entry('saved')] });
    const s = await setup(); s.accountScope.set('A'); mocks.online = false; await s.flushProgress();
    expect(mocks.reportProgress).not.toHaveBeenCalled(); mocks.online = true; mocks.reconnect?.();
    await Promise.resolve(); await Promise.resolve(); expect(mocks.reportProgress).toHaveBeenCalledOnce();
  });
  it('recovers only the file belonging to the verified account', async () => {
    mocks.saved = JSON.stringify({ accountId: 'A', entries: [entry('old-A')] });
    const s = await setup(); s.accountScope.set('B');
    expect(s.heldProgressCount()).toBe(0);
    s.holdProgress(entry('new-B')); await s.flushProgress();
    expect(mocks.reportProgress.mock.calls.map((call) => call[0])).toEqual(['new-B']);
  });
  it('retains the same account file after restart and refuses legacy unowned files', async () => {
    mocks.saved = JSON.stringify({ accountId: 'A', entries: [entry('saved')] });
    const s = await setup(); s.accountScope.set('A'); expect(s.heldProgressCount()).toBe(1);
    s.accountScope.set(null, true); mocks.saved = JSON.stringify([entry('unowned')]);
    s.accountScope.set('B'); expect(s.heldProgressCount()).toBe(0);
  });
  it('stops a flush on account switch and does not let its finalizer alter B entries', async () => {
    const s = await setup(); s.accountScope.set('A');
    s.holdProgress(entry('A-one')); s.holdProgress(entry('A-two'));
    let finish!: () => void;
    mocks.reportProgress.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const old = s.flushProgress();
    s.accountScope.set(null, true); s.accountScope.set('B'); s.holdProgress(entry('B-one'));
    finish(); await old;
    expect(mocks.reportProgress.mock.calls.map((call) => call[0])).toEqual(['A-one']);
    expect(s.heldProgressCount()).toBe(1);
    await s.flushProgress(); expect(mocks.reportProgress.mock.calls.map((call) => call[0])).toEqual(['A-one', 'B-one']);
  });
  it('rejects a delayed failure callback from the old generation', async () => {
    const s = await setup(); s.accountScope.set('A'); const old = s.accountScope.snapshot();
    s.accountScope.set(null, true); s.accountScope.set('B');
    s.holdProgress(entry('A-late'), old); expect(s.heldProgressCount()).toBe(0);
  });
});
