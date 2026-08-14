/**
 * Health.
 *
 * Two endpoints, because they answer different questions:
 *
 *  - `/health` is liveness. Is the process up? No I/O, so a platform's health
 *    check never restarts a healthy server because Postgres blipped.
 *  - `/health/ready` is readiness. Can it actually serve? Touches the
 *    database, and is what the keepalive cron hits to stop Supabase's free
 *    tier pausing the project after seven idle days.
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export function healthRoutes(app: FastifyInstance): void {
  app.get('/health', async () => ({
    ok: true,
    data: { status: 'up', uptimeSec: Math.round(process.uptime()) },
  }));

  app.get('/health/ready', async (_request, reply) => {
    const startedAt = performance.now();

    try {
      await app.db.execute(sql`select 1`);
    } catch (error) {
      app.log.error({ err: error }, 'readiness check failed');
      return reply.status(503).send({
        ok: false,
        error: { code: 'upstream_unavailable', message: 'Database unreachable' },
      });
    }

    return {
      ok: true,
      data: {
        status: 'ready',
        databaseLatencyMs: Math.round(performance.now() - startedAt),
        cache: app.cache.client ? 'connected' : 'disabled',
      },
    };
  });
}
