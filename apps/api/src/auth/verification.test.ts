/**
 * Email verification, gated on a mail provider being configured.
 *
 * The property worth protecting is the one that is easy to break by tightening
 * security: turning verification on when nothing can send a code locks every
 * new account out of the app it just created, with no way back — "resend" fails
 * identically. So both halves are asserted, not just the strict one.
 *
 * One server per configuration, built in `beforeAll` rather than per test.
 * Each `buildServer` boots a real Postgres compiled to WASM and runs the
 * migrations; doing that four times pushes a suite that asserts almost nothing
 * past its timeout.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { buildServer } from '../server.ts';
import { isSensitiveAuthPath } from './plugin.ts';

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'pglite://memory',
  CORS_ORIGINS: 'http://localhost:3000',
} as const;

function signUp(instance: FastifyInstance, email: string) {
  return instance.inject({
    method: 'POST',
    url: '/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery', name: 'Test Listener' },
  });
}

describe('with no mail provider configured', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer(loadConfig(BASE));
  });

  afterAll(async () => {
    await app.close();
  });

  it('signs a new account straight in rather than stranding it', async () => {
    const response = await signUp(app, 'nomail@example.com');

    expect(response.statusCode).toBe(200);
    // A session token means the account is usable immediately. Requiring
    // verification here would be unrecoverable: nothing can deliver a code.
    expect((response.json() as { token?: string }).token).toBeTruthy();
  });

  it('does not publish OTP endpoints that could never deliver', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/email-otp/send-verification-otp',
      payload: { email: 'nomail@example.com', type: 'email-verification' },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('with a mail provider configured', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer(loadConfig({ ...BASE, RESEND_API_KEY: 'test-key' }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses to sign in until the address is confirmed', async () => {
    await signUp(app, 'pending@example.com');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/sign-in/email',
      payload: { email: 'pending@example.com', password: 'correct-horse-battery' },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    // The client branches on this code to show the code-entry screen instead of
    // an error, so it is part of the contract rather than an implementation
    // detail. Matching the message instead would break on any rewording.
    expect((response.json() as { code?: string }).code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('exposes the endpoints the verification screen calls', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/email-otp/verify-email',
      payload: { email: 'pending@example.com', otp: '000000' },
    });

    // Wrong code, but routed — a 404 here would mean the plugin never mounted.
    expect(response.statusCode).not.toBe(404);
  });
});

describe('throttling', () => {
  /**
   * A six-digit code is the smallest secret this API accepts. The plugin caps
   * attempts per code, but that ceiling only holds if requesting fresh codes is
   * itself limited — and Better Auth's own limiter is in-memory, so per-instance
   * and cleared by every deploy.
   */
  it('counts the OTP endpoints as credential endpoints', () => {
    expect(isSensitiveAuthPath('/auth/email-otp/verify-email')).toBe(true);
    expect(isSensitiveAuthPath('/auth/email-otp/send-verification-otp')).toBe(true);
  });

  it('still leaves ordinary session reads alone', () => {
    // This fires on every page load; throttling it would rate-limit browsing.
    expect(isSensitiveAuthPath('/auth/get-session')).toBe(false);
  });
});
