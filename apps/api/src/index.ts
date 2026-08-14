/**
 * Entry point. Boot, listen, and shut down without dropping requests.
 */

import { loadConfig } from './config.ts';
import { buildServer } from './server.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);

  // Drain in-flight requests before exiting. Without this, a deploy cuts
  // whatever was mid-response — which on a podcast app means a client that
  // just reported a playback position never learns whether it was saved.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutting down');
      void app.close().then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error({ err: error }, 'failed to shut down cleanly');
          process.exit(1);
        },
      );
    });
  }

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  // The logger may not exist yet if config failed, so this one goes to stderr.
  console.error('Failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
