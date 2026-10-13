import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  run: vi.fn(),
  schema: vi.fn(),
}));
vi.mock('./queue.ts', () => ({ claimNext: mocks.claim }));
vi.mock('./queue-schema.ts', () => ({ assertJobSchema: mocks.schema }));
vi.mock('./transcribe.ts', () => ({ runJob: mocks.run }));
import { startWorker, SHUTDOWN_GRACE_MS } from './worker.ts';
const app = {
  db: {},
  log: { info: vi.fn(), error: vi.fn() },
} as unknown as FastifyInstance;
beforeEach(() => {
  vi.useFakeTimers();
  mocks.claim.mockReset();
  mocks.run.mockReset();
  mocks.schema.mockReset();
  mocks.schema.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
describe('worker shutdown and schema gate', () => {
  it('stops during an idle poll without advancing its timer', async () => {
    mocks.claim.mockResolvedValue(null);
    const worker = startWorker(app);
    await vi.advanceTimersByTimeAsync(0);
    await worker.stop();
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops during error backoff without advancing its timer', async () => {
    mocks.claim.mockRejectedValue(new Error('isolated database outage'));
    const worker = startWorker(app);
    await vi.advanceTimersByTimeAsync(0);
    await worker.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.claim).toHaveBeenCalledOnce();
  });
  it('cancels active work and waits for its settlement', async () => {
    mocks.claim.mockResolvedValue({ episodeId: 'isolated' });
    let signal!: AbortSignal;
    mocks.run.mockImplementation(async (_app, _job, options) => {
      signal = options.signal;
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
    });
    const worker = startWorker(app);
    await vi.advanceTimersByTimeAsync(0);
    await worker.stop();
    expect(signal.aborted).toBe(true);
    expect(mocks.run).toHaveBeenCalledOnce();
  });
  it('never claims or runs a job when schema capability is incompatible', async () => {
    mocks.schema.mockRejectedValue(new Error('missing lease schema'));
    const worker = startWorker(app);
    await worker.stop();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('rechecks schema after startup unavailability and admits no work before recovery', async () => {
    mocks.schema.mockRejectedValueOnce(new Error('temporary database outage')).mockResolvedValue(undefined);
    mocks.claim.mockResolvedValue(null);
    const worker = startWorker(app); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.claim).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.schema).toHaveBeenCalledTimes(2); expect(mocks.claim).toHaveBeenCalledOnce();
    await worker.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds shutdown when active settlement ignores cancellation', async () => {
    mocks.claim.mockResolvedValue({ episodeId: 'isolated' });
    mocks.run.mockImplementation(() => new Promise(() => undefined));
    const worker = startWorker(app);
    await vi.advanceTimersByTimeAsync(0);
    const stopping = worker.stop();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS);
    await stopping;
    expect(app.log.error).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('requires recovery'),
    );
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
