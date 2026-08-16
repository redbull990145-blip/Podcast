/**
 * The transcription worker as its own process.
 *
 * Optional. The worker runs inside the API by default and that is a perfectly
 * good deployment — the jobs are durable now, so a restart costs a retry rather
 * than the job. This entrypoint exists for when transcription should not share
 * a container with request handling: a job holds an entire episode in memory,
 * and on a small instance that is enough to get the process killed, taking
 * every in-flight request with it.
 *
 * Run it with `TRANSCRIBE_WORKER=off` on the web service so the work happens in
 * exactly one place, and `npm run worker` here. Same code, same queue; only the
 * process boundary moves.
 *
 * It builds the full server rather than a cut-down one, and simply never
 * listens. The worker needs the database, the config and the logger, and a
 * second way of assembling those is a second thing to keep in step with the
 * first — for the sake of not opening a port.
 */

import { loadConfig } from './config.ts';
import { attachWorker } from './run-worker.ts';
import { buildServer } from './server.ts';

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.runWorker) {
    // Refuse rather than idle: a worker service that starts cleanly and does
    // nothing is indistinguishable from a healthy one, and the queue simply
    // stops draining with no error anywhere to explain it.
    throw new Error(
      'TRANSCRIBE_WORKER is off, so this process would do nothing. ' +
        'Set it to `on` here, and to `off` on the web service.',
    );
  }

  const app = await buildServer(config);
  attachWorker(app);

  app.log.info('transcription worker process ready');

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutting down');
      // `close` runs the onClose hook that stops the loop, which waits for the
      // job in flight. A deploy therefore finishes the current episode instead
      // of abandoning it to be reclaimed and paid for twice.
      void app.close().then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error({ err: error }, 'failed to shut down cleanly');
          process.exit(1);
        },
      );
    });
  }
}

main().catch((error: unknown) => {
  console.error('Failed to start worker:', error instanceof Error ? error.message : error);
  process.exit(1);
});
