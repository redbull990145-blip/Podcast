/**
 * Attaching the transcription worker to a running process.
 *
 * Kept out of `buildServer` on purpose. That function is a *factory* — the
 * thing that lets tests drive the API with `app.inject()` and no socket — and a
 * background loop that polls the database is not part of building an app. Two
 * suites here deliberately build a server with `NODE_ENV=production` and a
 * connection string pointing nowhere, because all they inspect is which cookie
 * attributes and proxy settings that configuration produces. Starting a worker
 * inside the factory meant those builds began querying a database that does not
 * exist, and failed on it.
 *
 * So the worker is attached by whoever owns the process, which is the entry
 * point in both deployments: the API, or the standalone worker.
 */

import type { FastifyInstance } from 'fastify';
import { startWorker } from './ai/worker.ts';

/**
 * Start the worker if this process is meant to run one, and stop it on close.
 *
 * The `onClose` hook is what keeps shutdown honest: a loop still polling after
 * `app.close()` holds the database handle open, so the process lingers instead
 * of exiting and a deploy waits for a timeout it did not need to.
 */
export function attachWorker(app: FastifyInstance): void {
  if (!app.config.runWorker) {
    app.log.info('transcription worker disabled here (TRANSCRIBE_WORKER=off)');
    return;
  }

  const worker = startWorker(app);

  app.addHook('onClose', async () => {
    await worker.stop();
  });
}
