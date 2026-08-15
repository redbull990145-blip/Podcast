/**
 * Rate limiting is only as good as the identifier it keys on.
 *
 * These tests exist because an earlier version keyed on `request.ip` with
 * `trustProxy: true`, which trusts the whole `X-Forwarded-For` chain and returns
 * its leftmost entry — a value the caller writes. Every limit in the API was
 * bypassable by sending a different header each time, including the `expensive`
 * tier that gates transcription and LLM calls.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { rateLimitIdentity } from './rate-limit.ts';
import { buildServer } from './server.ts';

const BASE_ENV = {
  NODE_ENV: 'production' as const,
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
  BETTER_AUTH_SECRET: 'a-long-enough-production-secret',
  CORS_ORIGINS: 'https://example.com',
};

describe('client address behind a proxy', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer(loadConfig(BASE_ENV));
    app.get('/test/whoami', async (request) => ({
      ok: true,
      data: { ip: request.ip, identity: rateLimitIdentity(request) },
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('ignores a forwarded address the caller prepended', async () => {
    // The proxy appends the real peer; anything to its left is the caller's
    // invention. With one trusted hop we read the rightmost entry, so the
    // spoofed value is never what gets rate-limited.
    const response = await app.inject({
      method: 'GET',
      url: '/test/whoami',
      headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' },
    });

    expect(response.json().data.ip).toBe('198.51.100.7');
    expect(response.json().data.ip).not.toBe('203.0.113.9');
  });

  it('gives two spoofing attempts from one caller the same identity', async () => {
    // The point of the fix: rotating the header must not mint a fresh budget.
    const ids = await Promise.all(
      ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map(async (spoof) => {
        const response = await app.inject({
          method: 'GET',
          url: '/test/whoami',
          headers: { 'x-forwarded-for': `${spoof}, 198.51.100.7` },
        });
        return response.json().data.identity;
      }),
    );

    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe('ip:198.51.100.7');
  });

  it('falls back to the socket address when nothing is forwarded', async () => {
    const response = await app.inject({ method: 'GET', url: '/test/whoami' });
    expect(response.json().data.ip).toBe('127.0.0.1');
  });
});

describe('trusting no proxy at all', () => {
  it('ignores forwarding headers entirely when TRUST_PROXY_HOPS is 0', async () => {
    // The correct setting for a server exposed directly, where any
    // X-Forwarded-For present is by definition the caller's fabrication.
    const app = await buildServer(loadConfig({ ...BASE_ENV, TRUST_PROXY_HOPS: '0' }));
    app.get('/test/whoami', async (request) => ({ ok: true, data: { ip: request.ip } }));

    const response = await app.inject({
      method: 'GET',
      url: '/test/whoami',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });

    expect(response.json().data.ip).toBe('127.0.0.1');
    await app.close();
  });
});

describe('rateLimitIdentity', () => {
  const request = (over: Record<string, unknown>) => over as never;

  it('bills a signed-in caller to their session, not their address', async () => {
    // Two phones on one carrier NAT must not share a budget, and a user who
    // changes network mid-session must not be handed a fresh one.
    const identity = rateLimitIdentity(
      request({ user: { id: 'user-1' }, ip: '198.51.100.7' }),
    );
    expect(identity).toBe('u:user-1');
  });

  it('namespaces users apart from addresses', async () => {
    // Without the prefix a user whose id happened to look like an address
    // would share a bucket with that address.
    expect(rateLimitIdentity(request({ user: null, ip: '10.0.0.1' }))).toBe('ip:10.0.0.1');
    expect(rateLimitIdentity(request({ user: { id: '10.0.0.1' }, ip: '203.0.113.1' }))).toBe(
      'u:10.0.0.1',
    );
  });
});
