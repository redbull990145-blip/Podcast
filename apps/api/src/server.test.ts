import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { AppError } from './errors.ts';
import { buildServer } from './server.ts';

/**
 * These drive the app through `inject()` — no socket, no port, no database
 * connection until a route actually queries. postgres-js connects lazily, so
 * a syntactically valid URL is enough to build the server.
 */
describe('server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
        CORS_ORIGINS: 'http://localhost:3000',
      }),
    );

    // Fastify seals its route table on the first request, so these probe
    // routes have to be registered before anything is injected.
    app.get('/test/app-error', async () => {
      throw new AppError('forbidden', 'Not yours');
    });
    app.get('/test/rate-limited', async () => {
      throw new AppError('rate_limited', 'Slow down', { retryAfterSec: 42 });
    });
    app.get('/test/boom', async () => {
      throw new Error('a Postgres error string that must not leak');
    });
    app.post('/test/echo', async (request) => ({ ok: true, data: request.body }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports liveness without touching the database', async () => {
    // Liveness must not depend on Postgres, or a database blip gets the
    // process killed and restarted by the platform for no reason.
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, data: { status: 'up' } });
  });

  it('answers an unknown route in the standard envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('sets security headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  describe('error envelope', () => {
    it('maps an AppError code to its HTTP status', async () => {
      const response = await app.inject({ method: 'GET', url: '/test/app-error' });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        ok: false,
        error: { code: 'forbidden', message: 'Not yours' },
      });
    });

    it('sends Retry-After when the error carries one', async () => {
      const response = await app.inject({ method: 'GET', url: '/test/rate-limited' });

      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBe('42');
      expect(response.json().error.retryAfterSec).toBe(42);
    });

    it('never leaks an unexpected error message to the client', async () => {
      // The detail belongs in the log, not in the response. Leaking it tells
      // an attacker about the schema and tells the user nothing.
      const response = await app.inject({ method: 'GET', url: '/test/boom' });

      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('Postgres');
      expect(response.json()).toEqual({
        ok: false,
        error: { code: 'internal', message: 'Something went wrong on our end' },
      });
    });

    it('reports malformed JSON as a client error, not a server error', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/test/echo',
        headers: { 'content-type': 'application/json' },
        payload: '{"broken":',
      });

      expect(response.statusCode).toBeLessThan(500);
      expect(response.json().ok).toBe(false);
    });
  });
});
