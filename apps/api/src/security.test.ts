/**
 * The properties that keep a cross-site page from acting as a signed-in user.
 *
 * Production sets `SameSite=None` on the session cookie, because the web app
 * (Vercel) and this API (Render) are genuinely different registrable domains
 * and a `Lax` cookie would never be sent. That is the right call, but it means
 * the browser attaches the session to *any* cross-site request — so nothing
 * about SameSite is doing the CSRF work, and whatever is doing it should be
 * asserted rather than assumed.
 *
 * Cookie-bearing writes require a trusted Origin even with no body. Parser
 * restrictions and CORS preflights add barriers for requests with bodies.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isSensitiveAuthPath } from './auth/plugin.ts';
import { loadConfig } from './config.ts';
import { AppError } from './errors.ts';
import type { RateLimiter } from './rate-limit.ts';
import { buildServer } from './server.ts';

describe('cross-site request forgery', () => {
  let app: FastifyInstance;
  let mutations = 0;

  beforeAll(async () => {
    app = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
        CORS_ORIGINS: 'https://cue.example',
      }),
    );
    app.route({ method: ['POST', 'PUT', 'PATCH', 'DELETE'], url: '/test/mutate', handler: async () => ({ ok: true, data: { mutations: ++mutations } }) });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('rejects every untrusted cookie Origin for %s before mutation', async (method) => {
    for (const origin of [undefined, 'null', '::::', 'https://cue.example/path', 'https://cue.example.attacker.example', 'https://attacker.example']) {
      for (const authorization of [undefined, 'Bearer fake']) {
        const before = mutations;
        const response = await app.inject({ method, url: '/test/mutate', headers: { cookie: 'session=anything', ...(origin ? { origin } : {}), ...(authorization ? { authorization } : {}) } });
        expect(response.statusCode).toBe(403);
        expect(mutations).toBe(before);
      }
    }
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('supports trusted cookie and cookie-free bearer transport for %s', async (method) => {
    for (const headers of [{ cookie: 'session=anything', origin: 'https://cue.example' }, { authorization: 'Bearer fake' }]) {
      const before = mutations;
      const response = await app.inject({ method, url: '/test/mutate', headers });
      expect(response.statusCode).toBe(200);
      expect(mutations).toBe(before + 1);
    }
  });

  for (const origin of [undefined, 'null', 'https://attacker.example']) {
    it(`rejects an empty-body cookie write with Origin ${String(origin)}`, async () => {
      const response = await app.inject({ method: 'POST', url: '/test/mutate', headers: { cookie: 'session=anything', ...(origin ? { origin } : {}) } });
      expect(response.statusCode).toBe(403);
    });
  }
  it('does not let a fake bearer header bypass the cookie Origin check', async () => {
    const response = await app.inject({ method: 'POST', url: '/test/mutate', headers: { cookie: 'session=anything', authorization: 'Bearer fake', origin: 'https://attacker.example' } });
    expect(response.statusCode).toBe(403);
  });
  it('allows empty-body writes from the trusted app and cookie-free native clients', async () => {
    for (const headers of [{ cookie: 'session=anything', origin: 'https://cue.example' }, {}]) {
      const response = await app.inject({ method: 'POST', url: '/test/mutate', headers });
      expect(response.statusCode).toBe(200);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * The three content types a cross-site `<form>` can send. A form needs no
   * preflight and no JavaScript, so if any of these reached a handler the
   * session cookie would come with it.
   */
  for (const contentType of [
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
  ]) {
    it(`refuses a ${contentType} body outright`, async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/test/mutate',
        headers: { 'content-type': contentType },
        payload: 'episodeId=whatever',
      });

      // 415: no parser is registered for it, so the handler is never reached.
      expect(response.statusCode).toBe(415);
    });
  }

  it('refuses a cross-site preflight from an origin not on the allowlist', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/test/mutate',
      headers: {
        origin: 'https://attacker.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    // Without this header the browser blocks the real request from ever
    // being sent — which is the only thing standing between a malicious page
    // and a JSON POST carrying the user's cookie.
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows the preflight from the real web app', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/test/mutate',
      headers: {
        origin: 'https://cue.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(response.headers['access-control-allow-origin']).toBe('https://cue.example');
    // Credentials must be allowed or the session cookie is never attached and
    // the whole app is signed out cross-origin.
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('session cookie attributes', () => {
  it('is httpOnly and Secure with SameSite=None in production', async () => {
    // httpOnly is what keeps an XSS bug from reading the session; Secure keeps
    // SameSite=None legal at all, since browsers drop an insecure one.
    const app = await buildServer(
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
        BETTER_AUTH_SECRET: 'a-long-enough-production-secret',
        CORS_ORIGINS: 'https://cue.example',
      }),
    );

    const options = app.auth.options.advanced?.defaultCookieAttributes;

    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'none' });
    await app.close();
  });

  it('does not send a Secure cookie over plain-http development', async () => {
    // A Secure cookie on http://localhost is dropped silently, which reads as
    // "sign-in does nothing" rather than as a cookie policy problem.
    const app = await buildServer(
      loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
      }),
    );

    expect(app.auth.options.advanced?.defaultCookieAttributes).toMatchObject({
      secure: false,
      sameSite: 'lax',
    });
    await app.close();
  });
});

/**
 * Online password guessing.
 *
 * The `/auth/*` routes are Better Auth's, and they bypass the app's per-route
 * rate-limit preHandler entirely. Better Auth's own limiter is off outside
 * production and in-memory within it — so a signed-out attacker could spray
 * sign-in as fast as the network allowed, which under test was completely
 * unthrottled. The credential endpoints now go through the app's own limiter
 * first, keyed by address.
 */
describe('credential-endpoint throttling', () => {
  it('classifies only the credential-checking auth paths as sensitive', () => {
    expect(isSensitiveAuthPath('/auth/sign-in/email')).toBe(true);
    expect(isSensitiveAuthPath('/auth/sign-in/social')).toBe(true);
    expect(isSensitiveAuthPath('/auth/sign-up/email')).toBe(true);
    expect(isSensitiveAuthPath('/auth/forget-password')).toBe(true);
    expect(isSensitiveAuthPath('/auth/reset-password?token=abc')).toBe(true);
    expect(isSensitiveAuthPath('/auth/send-verification-email')).toBe(true);

    // The read-only lookups every page load makes must not be throttled.
    expect(isSensitiveAuthPath('/auth/get-session')).toBe(false);
    expect(isSensitiveAuthPath('/auth/sign-out')).toBe(false);
  });

  async function withStubLimiter(): Promise<{
    app: FastifyInstance;
    seen: string[];
    reset: () => void;
  }> {
    const app = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'pglite://memory',
        CORS_ORIGINS: 'https://cue.example',
      }),
    );

    // The Redis-backed limiter is a no-op without Redis (dev/test), so stand a
    // counting one in its place to prove the credential routes are wired to it.
    const seen: string[] = [];
    let authCalls = 0;
    const stub: RateLimiter = {
      check: async (identifier, tier) => {
        seen.push(`${tier} ${identifier}`);
        if (tier === 'auth' && ++authCalls > 3) {
          throw new AppError('rate_limited', 'Too many attempts — slow down');
        }
      },
    };
    (app as unknown as { rateLimiter: RateLimiter }).rateLimiter = stub;

    return { app, seen, reset: () => (authCalls = 0) };
  }

  it('refuses repeated sign-in attempts from one address once the budget is spent', async () => {
    const { app, seen } = await withStubLimiter();

    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/auth/sign-in/email',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'nobody@cue.example', password: 'guessing' }),
      });

    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) codes.push((await attempt()).statusCode);

    // The first few pass the limiter and fail auth; the rest are refused before
    // Better Auth — and its scrypt — ever runs.
    expect(codes.filter((code) => code === 429).length).toBeGreaterThan(0);
    // Keyed by address, in the auth tier.
    expect(seen.every((entry) => entry.startsWith('auth '))).toBe(true);
    expect(seen[0]).toContain('auth:127.0.0.1');

    await app.close();
  });

  it('does not throttle the read-only session lookup', async () => {
    const { app, seen } = await withStubLimiter();

    for (let i = 0; i < 5; i += 1) {
      await app.inject({ method: 'GET', url: '/auth/get-session' });
    }

    expect(seen).toHaveLength(0);
    await app.close();
  });

  it('throttles the direct verification-email endpoint before the mail handler', async () => {
    const { app, seen } = await withStubLimiter();
    for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: '/auth/send-verification-email', payload: { email: 'nobody@cue.example' } });
    const limited = await app.inject({ method: 'POST', url: '/auth/send-verification-email', payload: { email: 'nobody@cue.example' } });
    expect(limited.statusCode).toBe(429);
    expect(seen).toHaveLength(4);
    await app.close();
  });
});
