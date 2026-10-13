import { sessions } from '@cue/db';
import { betterAuth } from 'better-auth';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { buildServer } from '../server.ts';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'pglite://memory', CORS_ORIGINS: 'http://localhost:3000' }));
  await app.ready();
});
afterAll(async () => { await app.close(); });

/** Mint an old-version cached cookie to test an upgrade with cookies already installed. */
async function legacySession(email: string) {
  const oldAuth = betterAuth({
    ...app.auth.options,
    session: { ...app.auth.options.session, cookieCache: { enabled: true, maxAge: 300 } },
  });
  const response = await oldAuth.handler(new Request('http://localhost:8080/auth/sign-up/email', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password: 'correct-horse-battery', name: 'Old Client' }),
  }));
  expect(response.status).toBe(200);
  const body = await response.json() as { token: string; user: { id: string } };
  const cookie = response.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
  expect(cookie).toContain('session_data=');
  return { ...body, cookie };
}

describe('authoritative session revocation', () => {
  it('rejects a replayed cached cookie immediately after sign-out', async () => {
    const departing = await legacySession('cached-revoke@example.com');
    const other = await legacySession('cached-other@example.com');
    const signedOut = await app.inject({ method: 'POST', url: '/auth/sign-out', headers: { cookie: departing.cookie, origin: 'http://localhost:3000' } });
    expect(signedOut.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie: departing.cookie } });
    expect(me.json().data.user).toBeNull();
    const profile = await app.inject({ method: 'GET', url: '/me/profile', headers: { cookie: departing.cookie } });
    expect(profile.statusCode).toBe(401);
    const authSession = await app.inject({ method: 'GET', url: '/auth/get-session', headers: { cookie: departing.cookie } });
    expect(authSession.json()).toBeNull();
    const retained = await app.inject({ method: 'GET', url: '/me', headers: { cookie: other.cookie } });
    expect(retained.json().data.user.id).toBe(other.user.id);
  });

  it('checks server expiry even when the signed cached payload has time remaining', async () => {
    const old = await legacySession('cached-expired@example.com');
    await app.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.token, old.token));
    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie: old.cookie } });
    expect(me.json().data.user).toBeNull();
    const profile = await app.inject({ method: 'GET', url: '/me/profile', headers: { cookie: old.cookie } });
    expect(profile.statusCode).toBe(401);
  });
});
