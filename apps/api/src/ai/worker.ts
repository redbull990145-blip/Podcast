/** One worker slot; shutdown wakes waits and cancels the active attempt. */
import type { FastifyInstance } from 'fastify';
import { delay, withDeadline } from './deadline.ts';
import { claimNext } from './queue.ts';
import { assertJobSchema } from './queue-schema.ts';
import { runJob } from './transcribe.ts';

const IDLE_POLL_MS = 5_000;
const ERROR_BACKOFF_MS = 30_000;
export const SHUTDOWN_GRACE_MS = 30_000;
export type Worker = { stop: () => Promise<void> };

export function startWorker(app: FastifyInstance): Worker {
  const shutdown = new AbortController();
  const pause = async (ms: number) => {
    try {
      await delay(ms, shutdown.signal);
    } catch {
      /* Shutdown wakes this wait. */
    }
  };
  const loop = (async () => {
    while (!shutdown.signal.aborted) {
      try {
        await assertJobSchema(app.db);
        break;
      } catch (error) {
        app.log.error({ err: error }, 'transcription worker waiting: schema unavailable or incompatible');
        await pause(ERROR_BACKOFF_MS);
      }
    }
    if (shutdown.signal.aborted) return;
    app.log.info('transcription worker started');
    while (!shutdown.signal.aborted) {
      let claimed: Awaited<ReturnType<typeof claimNext>>;
      try {
        claimed = await claimNext(app.db);
      } catch (error) {
        if (shutdown.signal.aborted) break;
        app.log.error({ err: error }, 'could not claim a transcription job');
        await pause(ERROR_BACKOFF_MS);
        continue;
      }
      if (!claimed) {
        await pause(IDLE_POLL_MS);
        continue;
      }
      app.log.info(
        { episodeId: claimed.episodeId, attempt: claimed.attempts, fundingSource: claimed.fundingSource },
        'transcription attempt claimed',
      );
      // A claim that finishes during shutdown still gets an owned cancellation.
      try {
        await runJob(app, claimed, { signal: shutdown.signal });
      } catch (error) {
        app.log.error(
          { err: error, episodeId: claimed.episodeId, attempt: claimed.attempts },
          'could not settle a transcription attempt',
        );
        if (!shutdown.signal.aborted) await pause(ERROR_BACKOFF_MS);
      }
    }
    app.log.info('transcription worker stopped');
  })();
  return {
    async stop() {
      shutdown.abort(Object.assign(new Error('Worker shutdown'), { name: 'AbortError' }));
      try {
        await withDeadline(() => loop, undefined, SHUTDOWN_GRACE_MS);
      } catch (error) {
        // A hung DB cannot be settled safely here. Leave the reservation/lease
        // for fenced recovery, report it, and let the process owner terminate.
        app.log.error(
          { err: error },
          'transcription shutdown grace expired; unfinished lease requires recovery',
        );
      }
    },
  };
}
