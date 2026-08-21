/**
 * Redis, treated as what it is: an accelerator, not a dependency.
 *
 * Postgres is the source of truth. Redis holds feed-fetch caching, rate-limit
 * counters and computed recommendations — all of which can be recomputed. So
 * every operation here fails soft: if Redis is unreachable or unconfigured,
 * a read misses and a write is dropped, and the request still succeeds.
 *
 * The alternative — letting a cache outage take the API down — is how a
 * performance optimisation turns into an availability problem.
 */

import { Redis } from '@upstash/redis';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.ts';

export type Cache = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Null when Redis is not configured — callers skip rate limiting entirely. */
  readonly client: Redis | null;
};

/** Cache is disabled: every read misses, every write is a no-op. */
const noopCache: Cache = {
  get: async () => null,
  set: async () => {},
  del: async () => {},
  client: null,
};

export function createCache(config: Config, log: FastifyBaseLogger): Cache {
  if (!config.redis) {
    log.warn('REDIS_URL/REDIS_TOKEN not set — caching and rate limiting are disabled');
    return noopCache;
  }

  const client = new Redis({ url: config.redis.url, token: config.redis.token });

  return {
    client,

    async get<T>(key: string): Promise<T | null> {
      try {
        return await client.get<T>(key);
      } catch (error) {
        log.warn({ err: error, key }, 'cache read failed; treating as a miss');
        return null;
      }
    },

    async set(key: string, value: unknown, ttlSec: number): Promise<void> {
      try {
        await client.set(key, value, { ex: ttlSec });
      } catch (error) {
        log.warn({ err: error, key }, 'cache write failed; continuing');
      }
    },

    async del(key: string): Promise<void> {
      try {
        await client.del(key);
      } catch (error) {
        log.warn({ err: error, key }, 'cache delete failed; entry will expire on its own');
      }
    },
  };
}

/**
 * Bumped when the *meaning* of a cached search changes.
 *
 * Results are held for an hour, and a cache is only an accelerator while the
 * thing it accelerates has not changed underneath it. Dropping the `clean`
 * parameter from the upstream query changed which feeds a search can return at
 * all — every explicit show went from invisible to findable — so without a new
 * namespace the fix would have been real and unobservable for an hour per term,
 * with the most-searched terms staying wrong the longest.
 *
 * Cheaper than deleting keys: the old ones simply expire unread.
 */
const SEARCH_SCHEMA = 'v2';

/** Key namespaces, in one place so they cannot collide by accident. */
export const cacheKey = {
  feed: (feedUrl: string) => `feed:${feedUrl}`,
  search: (query: string, language: string | undefined) =>
    `search:${SEARCH_SCHEMA}:${language ?? 'any'}:${query.toLowerCase()}`,
  trending: (language: string | undefined) => `trending:${SEARCH_SCHEMA}:${language ?? 'any'}`,
} as const;
