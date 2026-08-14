/**
 * Authentication and authorization, end to end.
 *
 * These run against a real in-memory Postgres and the real Better Auth
 * handler — no mocked sessions. The point is to prove the *boundary*: that a
 * signed-out caller cannot read user data, and that one user cannot see
 * another's, no matter which transport they authenticate with.
 */

import { podcasts } from '@cue/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { buildServer } from '../server.ts';

let app: FastifyInstance;

/** Sign up and return both transports the two clients use. */
async function signUp(email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery', name: 'Test Listener' },
  });

  const body = response.json() as { token: string; user: { id: string } };
  const setCookie = response.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie ?? ''])
    .map((entry) => String(entry).split(';')[0])
    .join('; ');

  return { token: body.token, cookie, userId: body.user.id };
}

beforeAll(async () => {
  app = await buildServer(
    loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'pglite://memory',
      CORS_ORIGINS: 'http://localhost:3000',
    }),
  );
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('sessions', () => {
  it('reports an anonymous caller rather than erroring', async () => {
    // "Are you signed in?" has a legitimate negative answer. Returning 401
    // would make every client treat a normal state as a failure.
    const response = await app.inject({ method: 'GET', url: '/me' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: { user: null } });
  });

  it('authenticates the web client by cookie', async () => {
    const { cookie, userId } = await signUp('cookie@example.com');

    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie },
    });

    expect(response.json().data.user.id).toBe(userId);
  });

  it('authenticates the Android client by bearer token', async () => {
    // Same session row, different transport — a phone has no cookie jar worth
    // relying on, so it sends the token from the OS keystore.
    const { token, userId } = await signUp('bearer@example.com');

    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.json().data.user.id).toBe(userId);
  });

  it('rejects a forged token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    expect(response.json().data.user).toBeNull();
  });

  it('refuses to create two accounts with the same email', async () => {
    await signUp('duplicate@example.com');

    const second = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      payload: {
        email: 'duplicate@example.com',
        password: 'correct-horse-battery',
        name: 'Impostor',
      },
    });

    expect(second.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects a password below the minimum length', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      payload: { email: 'short@example.com', password: 'abc', name: 'Short' },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('subscriptions', () => {
  let podcastId: string;

  beforeAll(async () => {
    const [row] = await app.db
      .insert(podcasts)
      .values({ feedUrl: 'https://example.com/auth-test.xml', title: 'Test Show' })
      .returning({ id: podcasts.id });
    podcastId = row!.id;
  });

  it('refuses every user-scoped route to an anonymous caller', async () => {
    for (const [method, url] of [
      ['GET', '/me/subscriptions'],
      ['PUT', `/me/subscriptions/${podcastId}`],
      ['DELETE', `/me/subscriptions/${podcastId}`],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.json().error.code).toBe('unauthorized');
    }
  });

  it('subscribes and lists', async () => {
    const { cookie } = await signUp('subscriber@example.com');

    await app.inject({
      method: 'PUT',
      url: `/me/subscriptions/${podcastId}`,
      headers: { cookie },
    });

    const list = await app.inject({ method: 'GET', url: '/me/subscriptions', headers: { cookie } });
    expect(list.json().data.items).toHaveLength(1);
    expect(list.json().data.items[0].title).toBe('Test Show');
  });

  it('treats a repeated subscribe as success, not a conflict', async () => {
    // The button is optimistic. A double tap returning 409 would make the UI
    // roll back a change that actually succeeded.
    const { cookie } = await signUp('double@example.com');

    const first = await app.inject({
      method: 'PUT',
      url: `/me/subscriptions/${podcastId}`,
      headers: { cookie },
    });
    const second = await app.inject({
      method: 'PUT',
      url: `/me/subscriptions/${podcastId}`,
      headers: { cookie },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/me/subscriptions', headers: { cookie } });
    expect(list.json().data.items).toHaveLength(1);
  });

  it('treats unsubscribing from something not subscribed as success', async () => {
    const { cookie } = await signUp('unsub@example.com');

    const response = await app.inject({
      method: 'DELETE',
      url: `/me/subscriptions/${podcastId}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.subscribed).toBe(false);
  });

  it('404s on subscribing to a podcast that does not exist', async () => {
    const { cookie } = await signUp('ghost@example.com');

    const response = await app.inject({
      method: 'PUT',
      url: '/me/subscriptions/00000000-0000-4000-8000-000000000000',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects a malformed id before it reaches a query', async () => {
    const { cookie } = await signUp('malformed@example.com');

    const response = await app.inject({
      method: 'PUT',
      url: '/me/subscriptions/not-a-uuid',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
  });

  it('never shows one user another user’s library', async () => {
    // The authorization boundary this whole API rests on: the user id comes
    // from the verified session, never from the request.
    const alice = await signUp('alice@example.com');
    const bob = await signUp('bob@example.com');

    await app.inject({
      method: 'PUT',
      url: `/me/subscriptions/${podcastId}`,
      headers: { cookie: alice.cookie },
    });

    const bobsLibrary = await app.inject({
      method: 'GET',
      url: '/me/subscriptions',
      headers: { cookie: bob.cookie },
    });

    expect(bobsLibrary.json().data.items).toEqual([]);
  });

  it('does not let one user unsubscribe another', async () => {
    const carol = await signUp('carol@example.com');
    const dave = await signUp('dave@example.com');

    await app.inject({
      method: 'PUT',
      url: `/me/subscriptions/${podcastId}`,
      headers: { cookie: carol.cookie },
    });

    await app.inject({
      method: 'DELETE',
      url: `/me/subscriptions/${podcastId}`,
      headers: { cookie: dave.cookie },
    });

    const carolsLibrary = await app.inject({
      method: 'GET',
      url: '/me/subscriptions',
      headers: { cookie: carol.cookie },
    });

    expect(carolsLibrary.json().data.items).toHaveLength(1);
  });
});
