/**
 * The server, as a factory.
 *
 * Building the app separately from listening on a port is what lets tests
 * drive it with `app.inject()` — no socket, no port collisions, no waiting.
 */

import { createDatabase, runMigrations, type Database } from '@cue/db';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { createAuth } from './auth/auth.ts';
import { registerAuth } from './auth/plugin.ts';
import { createCache, type Cache } from './cache.ts';
import {
  createPodcastIndexClient,
  type PodcastIndexClient,
} from './catalog/podcastindex.ts';
import type { Config } from './config.ts';
import { registerErrorHandler } from './errors.ts';
import { createRateLimiter, type RateLimiter } from './rate-limit.ts';
import { aiRoutes } from './routes/ai.ts';
import { healthRoutes } from './routes/health.ts';
import { libraryRoutes } from './routes/library.ts';
import { playbackRoutes } from './routes/playback.ts';
import { podcastRoutes } from './routes/podcasts.ts';
import { profileRoutes } from './routes/profile.ts';
import { transcriptRoutes } from './routes/transcripts.ts';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Database;
    cache: Cache;
    rateLimiter: RateLimiter;
    podcastIndex: PodcastIndexClient;
  }
}

export async function buildServer(config: Config): Promise<FastifyInstance> {
  const isTest = config.nodeEnv === 'test';

  const app = Fastify({
    logger: {
      // Tests assert on responses, not logs; a server that narrates every
      // injected request buries the one line that actually failed.
      level: isTest ? 'silent' : config.isProduction ? 'info' : 'debug',
      // Pretty logs are a dev-only luxury; in production they cost CPU and
      // break log ingestion, which expects one JSON object per line.
      ...(config.isProduction || isTest
        ? {}
        : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }),
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    // Trust the platform's proxy so `request.ip` is the caller, not the load
    // balancer — otherwise every request rate-limits against one identifier.
    trustProxy: config.isProduction,
    // A podcast API takes URLs and search strings, never large uploads.
    bodyLimit: 256 * 1024,
  });

  app.decorate('config', config);

  const db = await createDatabase({ connectionString: config.databaseUrl });
  app.decorate('db', db);

  // The local dev database is created empty on first run, so it migrates
  // itself. A real Postgres does not: migrating on boot means N instances race
  // each other during a rolling deploy, and it hides schema changes inside a
  // process start rather than making them a reviewed step.
  if (config.databaseUrl.startsWith('pglite:')) {
    const ran = await runMigrations(db);
    if (ran.length > 0) app.log.info({ migrations: ran }, 'applied migrations to dev database');
  }

  const cache = createCache(config, app.log);
  app.decorate('cache', cache);
  app.decorate('rateLimiter', createRateLimiter(cache));

  if (!config.podcastIndex) {
    app.log.warn('PODCASTINDEX_KEY/SECRET not set — search and trending will return an error');
  }

  if (!config.ai.operatorKey) {
    app.log.warn('GROQ_API_KEY not set — AI features will require each user to add their own key');
  }
  if (!config.ai.encryptionSecret) {
    // Refusing to store keys is the correct behaviour, but silently offering a
    // Settings field that always fails is not — so this is said out loud.
    app.log.warn('API_KEY_ENCRYPTION_SECRET not set — users cannot save their own API keys');
  }
  app.decorate('podcastIndex', createPodcastIndexClient(config.podcastIndex, cache));

  await app.register(helmet, {
    // This API serves JSON to apps, never HTML to a browser, so CSP has
    // nothing to protect here and only risks breaking the docs route later.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    // Required for the session cookie to be sent cross-origin at all.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });

  registerErrorHandler(app);

  await registerAuth(app, createAuth(db, config));

  healthRoutes(app);
  podcastRoutes(app);
  libraryRoutes(app);
  playbackRoutes(app);
  transcriptRoutes(app);
  aiRoutes(app);
  profileRoutes(app);

  return app;
}
