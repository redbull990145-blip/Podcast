/**
 * The transcription worker.
 *
 * A loop that claims one job at a time and runs it to completion. Deliberately
 * not a library: what a queue needs here is a claim that two workers cannot both
 * win, a heartbeat, and a retry ceiling, and Postgres already does all three.
 * Adding a broker would mean a second piece of infrastructure to run, pay for
 * and lose data in, to hold a queue that is usually empty.
 *
 * **Concurrency is one, per worker, on purpose.** A job buffers an entire
 * episode in memory to walk its frame boundaries — tens of megabytes — and then
 * copies each chunk again on its way to the provider. Two at once on a small
 * container is how the process gets killed, which is the failure this whole
 * change exists to stop happening.
 *
 * It runs inside the API process by default, which is not the same as running
 * *in the request*: the work is durable and resumable now, so a restart costs a
 * retry rather than the job. Setting `TRANSCRIBE_WORKER=off` and running
 * `npm run worker` moves it to its own process — the same code either way, so
 * moving it later is a deployment change and not a rewrite.
 */

import type { FastifyInstance } from 'fastify';
import { claimNext } from './queue.ts';
import { runJob } from './transcribe.ts';

/**
 * How long to wait after finding nothing.
 *
 * Polling, rather than `LISTEN`/`NOTIFY`, because the queue is empty almost all
 * of the time and a notification channel would have to survive reconnects to be
 * worth the complexity. Five seconds is imperceptible against a job measured in
 * minutes, and costs one indexed query that matches no rows.
 */
const IDLE_POLL_MS = 5_000;

/**
 * How long to wait after a job throws.
 *
 * Longer than the idle poll: if claiming or settling is what is broken, a tight
 * loop turns one failure into a flood of identical log lines and hammers a
 * database that is probably already unhappy.
 */
const ERROR_BACKOFF_MS = 30_000;

export type Worker = { stop: () => Promise<void> };

/**
 * Start claiming jobs until stopped.
 *
 * Returns a handle rather than a promise that never settles, so tests and a
 * graceful shutdown can end the loop deterministically instead of leaving a
 * timer holding the process open.
 */
export function startWorker(app: FastifyInstance): Worker {
  let running = true;
  let idle: NodeJS.Timeout | null = null;

  /** Sleep, but wake immediately if we are shutting down. */
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      idle = setTimeout(resolve, ms);
      idle.unref?.();
    });

  const loop = (async () => {
    app.log.info('transcription worker started');

    while (running) {
      /**
       * Declared without an initial value, deliberately.
       *
       * `null` is a meaningful answer here — it is what `claimNext` returns for
       * an empty queue, and it means "sleep briefly and ask again". Failing to
       * *reach* the queue means something else entirely: back off for much
       * longer. Seeding this with `null` would make those two states share a
       * value, so if the `continue` below were ever dropped, a database outage
       * would quietly read as an idle queue and poll it every five seconds.
       *
       * Left unassigned, that edit cannot compile: the read below would be a
       * use-before-assignment. The narrower declaration is the check.
       */
      let claimed: Awaited<ReturnType<typeof claimNext>>;

      try {
        claimed = await claimNext(app.db);
      } catch (error) {
        // The queue itself is unreachable. Back off rather than spin — this is
        // usually the database being briefly unavailable, which resolves.
        app.log.error({ err: error }, 'could not claim a transcription job');
        await pause(ERROR_BACKOFF_MS);
        continue;
      }

      if (!claimed) {
        await pause(IDLE_POLL_MS);
        continue;
      }

      app.log.info(
        { episodeId: claimed.episodeId, attempt: claimed.attempts },
        'transcription job claimed',
      );

      /**
       * `runJob` settles the job itself and is documented not to throw. This
       * catch is for the case where that contract is broken anyway: one
       * unhandled rejection here would end the loop, and the queue would go
       * quiet with no error and no worker — the exact silent-stall this change
       * set out to remove.
       */
      try {
        await runJob(app, claimed);
      } catch (error) {
        app.log.error(
          { err: error, episodeId: claimed.episodeId },
          'transcription job threw past its own handler',
        );
        await pause(ERROR_BACKOFF_MS);
      }
    }

    app.log.info('transcription worker stopped');
  })();

  return {
    async stop() {
      running = false;
      if (idle) clearTimeout(idle);
      await loop;
    },
  };
}
