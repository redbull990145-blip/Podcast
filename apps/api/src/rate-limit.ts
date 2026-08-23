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

import { createHash, timingSafeEqual } from 'node:crypto';

import { Ratelimit } from '@upstash/ratelimit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Cache } from './cache.ts';
import { AppError } from './errors.ts';

export type RateLimitTier = 'default' | 'catalogue' | 'search' | 'expensive' | 'auth';

/**
 * `search` is tighter because each miss costs an upstream call to PodcastIndex,
 * whose budget is shared by everyone using this deployment. `expensive` is for
 * anything that starts a transcription or an LLM call.
 *
 * `auth` guards the credential endpoints — sign-in, sign-up, password reset.
 * It is keyed by address, because there is no session yet to key on and the
 * threat is automated guessing from one origin. Ten attempts a minute stops a
 * spray (the demonstrated attack ran hundreds a minute unthrottled) without the
 * account-lockout approach's own flaw, where an attacker locks a victim out by
 * guessing at their account on purpose.
 */
const TIERS: Record<RateLimitTier, { tokens: number; window: `${number} ${'s' | 'm'}` }> = {
  default: { tokens: 120, window: '1 m' },
  /**
   * Public catalogue reads. Generous, because these are cheap, cacheable and
   * the ordinary way the app is used: opening Home is seven of them, and a
   * listener clicking through shows spends two per page. 300 leaves room for
   * that and still refuses a scraper walking the catalogue.
   */
  catalogue: { tokens: 300, window: '1 m' },
  search: { tokens: 20, window: '1 m' },
  expensive: { tokens: 10, window: '1 m' },
  auth: { tokens: 10, window: '1 m' },
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

/**
 * Whether a request is our own web app rendering a page, rather than a client.
 *
 * Compared in constant time. A plain `===` on a secret leaks its length and
 * then its content to anyone who can time the response — impractical over the
 * public internet, but the correct comparison costs one function call and
 * removes the need to argue about how impractical.
 *
 * Both operands are hashed to a fixed width first, because `timingSafeEqual`
 * throws on length mismatch — and a thrown exception on the *first* differing
 * byte length would itself be the timing oracle the function exists to close.
 */
function isInternalCaller(request: FastifyRequest, token: string): boolean {
  const presented = request.headers['x-cue-internal'];
  if (typeof presented !== 'string') return false;

  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(token).digest();

  return timingSafeEqual(a, b);
}

/**
 * The guard for public catalogue reads.
 *
 * Two things separate this from `rateLimit`:
 *
 * It exempts our own server-side renderer, which would otherwise share a single
 * IP-keyed budget across every page view in the world. See INTERNAL_API_TOKEN
 * in config.ts for the arithmetic — the short version is that a limit tight
 * enough to be worth having would take the front page down first.
 *
 * And it does nothing at all when no token is configured. That is deliberate
 * and it is the safe direction: without a token this process cannot tell its
 * own renderer from a stranger, and guessing wrong in the other direction
 * fails the app closed for everyone. An unconfigured deployment therefore
 * behaves exactly as it did before this existed.
 */
export function catalogueRateLimit(app: FastifyInstance, token: string | null) {
  if (!token) return undefined;

  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (isInternalCaller(request, token)) return;
    await app.rateLimiter.check(rateLimitIdentity(request), 'catalogue');
  };
}
