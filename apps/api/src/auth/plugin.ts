/**
 * Wiring Better Auth into Fastify.
 *
 * Better Auth speaks the Web `Request`/`Response` API. Fastify speaks Node's
 * streams. This module translates between them in both directions, which is
 * the whole job — everything else is Better Auth's.
 *
 * The `/auth/*` routes are registered with a wildcard and a raw body parser,
 * because Better Auth needs to read the body itself; letting Fastify parse the
 * JSON first would leave nothing on the stream for it to consume.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from './auth.ts';
import { AppError } from '../errors.ts';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
};

declare module 'fastify' {
  interface FastifyInstance {
    auth: Auth;
  }
  interface FastifyRequest {
    /** Null when the caller is anonymous. Routes decide whether that matters. */
    user: SessionUser | null;
  }
}

/** Rebuild the incoming Fastify request as a Web `Request`. */
function toWebRequest(request: FastifyRequest, baseUrl: string): Request {
  const url = new URL(request.url, baseUrl);

  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    } else {
      headers.append(key, value);
    }
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  return new Request(url.href, {
    method,
    headers,
    ...(hasBody && request.body !== undefined
      ? { body: typeof request.body === 'string' ? request.body : JSON.stringify(request.body) }
      : {}),
  });
}

/** Copy a Web `Response` back onto the Fastify reply. */
async function sendWebResponse(reply: FastifyReply, response: Response): Promise<void> {
  reply.status(response.status);

  response.headers.forEach((value, key) => {
    // `set-cookie` can legitimately appear more than once (session + csrf),
    // and Headers collapses repeats — `getSetCookie` is the only way to get
    // them back intact. Collapsing them silently drops a cookie.
    if (key.toLowerCase() === 'set-cookie') return;
    void reply.header(key, value);
  });

  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) void reply.header('set-cookie', cookies);

  const body = await response.text();
  void reply.send(body.length > 0 ? body : null);
}

export async function registerAuth(app: FastifyInstance, auth: Auth): Promise<void> {
  app.decorate('auth', auth);
  app.decorateRequest('user', null);

  /**
   * Resolve the session on every request, before any handler runs.
   *
   * Doing this once here — rather than in each protected route — means a route
   * can never forget to check, and `request.user` is always trustworthy.
   */
  app.addHook('onRequest', async (request) => {
    // The auth routes manage their own session handling.
    if (request.url.startsWith('/auth/')) return;

    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.append(key, value);
    }

    try {
      const session = await auth.api.getSession({ headers });
      request.user = session
        ? {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            image: session.user.image ?? null,
          }
        : null;
    } catch (error) {
      // A failed session lookup means "not signed in", not "server broken".
      // Throwing here would take down anonymous browsing too.
      request.log.warn({ err: error }, 'session lookup failed; treating as anonymous');
      request.user = null;
    }
  });

  /**
   * Better Auth reads the raw body itself, so `/auth/*` gets the string
   * untouched. Everything else is parsed as Fastify normally would.
   *
   * The `statusCode` below matters: Fastify's own parser tags a malformed-JSON
   * error as 400, and the error handler reads that tag to decide client-vs-
   * server fault. A bare SyntaxError carries no status and would be reported
   * as a 500 — blaming the server for the caller's typo.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body, done) => {
      if (request.url.startsWith('/auth/')) {
        done(null, body);
        return;
      }

      if (body === '') {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(body as string));
      } catch {
        const error = Object.assign(new Error('Body is not valid JSON'), {
          statusCode: 400,
        });
        done(error, undefined);
      }
    },
  );

  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    handler: async (request, reply) => {
      const response = await auth.handler(toWebRequest(request, request.server.config.authUrl));
      await sendWebResponse(reply, response);
    },
  });
}

/**
 * Assert a signed-in caller and return them.
 *
 * Every route touching user data calls this. Returning the user rather than
 * just checking means the `user_id` a query filters on always comes from the
 * verified session, never from the request body — which is the difference
 * between authorization and a suggestion.
 */
export function requireUser(request: FastifyRequest): SessionUser {
  if (!request.user) {
    throw new AppError('unauthorized', 'Sign in to do that');
  }
  return request.user;
}
