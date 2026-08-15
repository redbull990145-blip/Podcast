/**
 * Rate limiting.
 *
 * Sliding window rather than fixed: a fixed window lets a caller spend its
 * whole budget in the last second of one window and again in the first second
 * of the next, which is a 2× burst exactly when you didn't want one.
 *
 * Limits are per-identifier: the signed-in user where there is one, the client
 * address otherwise. See `rateLimitIdentity` for why that order matters.
 */

import { Ratelimit } from '@upstash/ratelimit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Cache } from './cache.ts';
import { AppError } from './errors.ts';

export type RateLimitTier = 'default' | 'search' | 'expensive';

/**
 * `search` is tighter because each miss costs an upstream call to PodcastIndex,
 * whose budget is shared by everyone using this deployment. `expensive` is for
 * anything that starts a transcription or an LLM call.
 */
const TIERS: Record<RateLimitTier, { tokens: number; window: `${number} ${'s' | 'm'}` }> = {
  default: { tokens: 120, window: '1 m' },
  search: { tokens: 20, window: '1 m' },
  expensive: { tokens: 10, window: '1 m' },
};

export type RateLimiter = {
  check(identifier: string, tier: RateLimitTier): Promise<void>;
};

export function createRateLimiter(cache: Cache): RateLimiter {
  if (!cache.client) {
    // No Redis in local development. Limiting per-process would be a different
    // behaviour than production, and a misleading one, so it's off entirely.
    return { check: async () => {} };
  }

  const limiters = new Map<RateLimitTier, Ratelimit>();
  for (const [tier, { tokens, window }] of Object.entries(TIERS)) {
    limiters.set(
      tier as RateLimitTier,
      new Ratelimit({
        redis: cache.client,
        limiter: Ratelimit.slidingWindow(tokens, window),
        prefix: `rl:${tier}`,
        // Counters are updated after the response goes out, so limiting never
        // sits in the latency path.
        analytics: false,
      }),
    );
  }

  return {
    async check(identifier: string, tier: RateLimitTier): Promise<void> {
      const limiter = limiters.get(tier);
      if (!limiter) return;

      let result: Awaited<ReturnType<Ratelimit['limit']>>;
      try {
        result = await limiter.limit(identifier);
      } catch {
        // Redis is down. Refusing traffic because the *limiter* is broken
        // would turn a cache outage into an outage.
        return;
      }

      if (!result.success) {
        const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
        throw new AppError('rate_limited', 'Too many requests — slow down a moment', {
          retryAfterSec,
        });
      }
    },
  };
}

/**
 * Who a request is billed to.
 *
 * The session id wins over the address whenever there is one, for two reasons.
 * It cannot be forged — a caller can put anything in a forwarding header, but
 * not in a signed session. And it does not collide: carrier-grade NAT puts
 * thousands of phones behind one address, so an IP-keyed budget silently
 * rations a whole mobile network to one user's worth of requests, which arrives
 * as "the app is broken on cellular" rather than as a limit being hit.
 *
 * Namespaced so a user id can never be confused with an address.
 */
export function rateLimitIdentity(request: FastifyRequest): string {
  return request.user ? `u:${request.user.id}` : `ip:${request.ip}`;
}

/**
 * Route-level guard. Applied per route rather than globally so each endpoint
 * declares the tier it actually belongs to.
 */
export function rateLimit(app: FastifyInstance, tier: RateLimitTier) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    await app.rateLimiter.check(rateLimitIdentity(request), tier);
  };
}
