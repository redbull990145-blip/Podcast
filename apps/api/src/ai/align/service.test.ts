import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  quota: vi.fn(),
  refund: vi.fn(),
  align: vi.fn(),
}));
vi.mock('../access.ts', () => ({
  claimQuota: mocks.quota,
  refundQuota: mocks.refund,
}));
vi.mock('./run.ts', () => ({ alignEpisode: mocks.align }));
import { isAligning, requestAlignment } from './service.ts';

const app = {} as FastifyInstance;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  mocks.quota.mockReset().mockResolvedValue({ metered: true, day: '2026-10-12' });
  mocks.refund.mockReset().mockResolvedValue(undefined);
  mocks.align.mockReset().mockResolvedValue({ status: 'in-sync', insertedMs: 0 });
});
afterEach(() => vi.restoreAllMocks());

describe('alignment admission ownership', () => {
  it('shares admission before quota resolves and charges only the original caller', async () => {
    const reservation = deferred<{ metered: boolean; day: string }>();
    const work = deferred<{ status: 'in-sync'; insertedMs: number }>();
    mocks.quota.mockReturnValue(reservation.promise);
    mocks.align.mockReturnValue(work.promise);
    const first = requestAlignment(app, 'concurrent-admission', 'A');
    const second = requestAlignment(app, 'concurrent-admission', 'B');
    const third = requestAlignment(app, 'concurrent-admission', 'A');
    expect(isAligning('concurrent-admission')).toBe(true);
    expect(mocks.quota).toHaveBeenCalledTimes(1);
    reservation.resolve({ metered: true, day: '2026-10-12' });
    await Promise.resolve();
    expect(mocks.align).toHaveBeenCalledTimes(1);
    expect(mocks.align).toHaveBeenCalledWith(app, 'concurrent-admission', 'A', {
      funding: 'operator',
    });
    work.resolve({ status: 'in-sync', insertedMs: 0 });
    const outcomes = await Promise.all([first, second, third]);
    expect(outcomes).toEqual(
      Array(3).fill({
        started: true,
        outcome: { status: 'in-sync', insertedMs: 0 },
      }),
    );
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith(app, 'A', '2026-10-12');
    expect(isAligning('concurrent-admission')).toBe(false);
  });

  it('clears failed admission without running/refunding and permits the next request', async () => {
    const reservation = deferred<{ metered: boolean; day: string }>();
    mocks.quota.mockReturnValueOnce(reservation.promise);
    const first = requestAlignment(app, 'quota-failure', 'A');
    const joined = requestAlignment(app, 'quota-failure', 'B');
    const settled = Promise.allSettled([first, joined]);
    reservation.reject(new Error('quota exhausted'));
    const outcomes = await settled;
    expect(outcomes.every((result) => result.status === 'rejected')).toBe(true);
    expect(mocks.quota).toHaveBeenCalledTimes(1);
    expect(mocks.align).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(isAligning('quota-failure')).toBe(false);
    await requestAlignment(app, 'quota-failure', 'B');
    expect(mocks.quota).toHaveBeenCalledTimes(2);
    expect(mocks.align).toHaveBeenCalledTimes(1);
  });

  it('retains admitted BYOK funding and never refunds operator quota after work fails', async () => {
    mocks.quota.mockResolvedValue({ metered: false, day: null });
    mocks.align.mockRejectedValue(new Error('removed own key'));
    expect(await requestAlignment(app, 'byok-failure', 'A')).toEqual({
      started: true,
      outcome: { status: 'failed', detail: 'removed own key' },
    });
    expect(mocks.align).toHaveBeenCalledWith(app, 'byok-failure', 'A', {
      funding: 'byok',
    });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(isAligning('byok-failure')).toBe(false);
  });
});
