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
    /** Authoritative expiry of the credential resolved for this request. */
    sessionExpiresAt: string | null;
  }
}

/**
 * The Better Auth endpoints that check or mint a credential.
 *
 * These are the guessing surface (`sign-in`, `email-otp`, `change-password`),
 * and the account-spam and enumeration surface (`sign-up`, password reset). The
 * read-only `get-session` that fires on every page load is deliberately not
 * here — throttling it would rate-limit ordinary browsing. Matched by substring
 * so `/auth/sign-in/email` and `/auth/sign-in/social` are both covered.
 *
 * `email-otp` belongs here for both halves of what it does. Verifying is a
 * guess against a six-digit code — the smallest secret this API accepts — and
 * while the plugin caps attempts per code, that cap is only as good as the
 * limit on requesting fresh ones. Sending is a request for us to email an
 * arbitrary address, which unthrottled is a spam relay pointed at our sending
 * reputation. Better Auth's own limiter covers neither durably: it is in-memory,
 * so per-instance and cleared by every deploy.
 */
const SENSITIVE_AUTH_PATHS = [
  '/sign-in',
  '/sign-up',
  '/forget-password',
  '/request-password-reset',
  '/change-password',
  '/reset-password',
  '/email-otp',
  '/send-verification-email',
];

export function isSensitiveAuthPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return SENSITIVE_AUTH_PATHS.some((needle) => path.includes(needle));
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
  app.decorateRequest('sessionExpiresAt', null);

  /**
   * Resolve the session on every request, before any handler runs.
   *
   * Doing this once here — rather than in each protected route — means a route
   * can never forget to check, and `request.user` is always trustworthy.
   */
  app.addHook('onRequest', async (request) => {
    // The auth routes manage their own session handling — but the credential
    // endpoints get an address-keyed throttle before Better Auth ever sees them.
    // Better Auth's own limiter is disabled outside production and in-memory
    // (so per-instance, and reset on every deploy) within it; neither is a
    // durable brake on password guessing. Without this a signed-out caller can
    // spray sign-in as fast as the network allows, which — tested — was
    // completely unthrottled.
    if (request.url.startsWith('/auth/')) {
      if (request.method === 'POST' && isSensitiveAuthPath(request.url)) {
        await request.server.rateLimiter.check(`auth:${request.ip}`, 'auth');
      }
      return;
    }

    // CORS only controls reading a response. Empty-body writes can be sent
    // without a preflight, so cookie authentication needs an Origin check.
    // Native bearer requests carry no cookie and do not need a browser Origin.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.cookie) {
      const origin = request.headers.origin;
      const trusted = [...app.config.corsOrigins, new URL(app.config.authUrl).origin];
      if (typeof origin !== 'string' || !trusted.includes(origin)) {
        throw new AppError('forbidden', 'This request needs a trusted Origin');
      }
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.append(key, value);
    }

    try {
      const session = await auth.api.getSession({ headers });
      request.sessionExpiresAt = session ? session.session.expiresAt.toISOString() : null;
      request.user = session
        ? {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            image: session.user.image ?? null,
          }
        : null;
    } catch (error) {
      // Public browsing may proceed anonymously through an auth outage. /me
      // must distinguish that outage from a rejected credential so a native
      // device can retain its last verified identity until the session expires.
      request.log.warn({ err: error }, 'session lookup failed; treating as anonymous');
      request.user = null;
      request.sessionExpiresAt = null;
      if (request.url.split('?')[0] === '/me') throw new AppError('upstream_unavailable', 'Session verification is temporarily unavailable');
    }
    // The account selected in a tab must match the session carrying the write.
    // Cookies can change in another tab before this tab receives its broadcast.
    const expectedAccount = request.headers['x-cue-account-id'];
    if (expectedAccount && request.user && expectedAccount !== request.user.id) {
      throw new AppError('forbidden', 'The account changed. Refresh your session.');
    }
  });

  app.addHook('onSend', async (request, reply) => {
    if (request.user) {
      void reply.header('X-Cue-Account-Id', request.user.id);
    }
    // Even a negative or unavailable identity must be verified on the network.
    if (request.user || request.url.split('?')[0] === '/me') {
      void reply.header('Cache-Control', 'private, no-store');
      const vary = String(reply.getHeader('vary') ?? '');
      void reply.header('Vary', [...new Set([...vary.split(',').map((v) => v.trim()).filter(Boolean), 'Cookie', 'Authorization'])].join(', '));
    }
  });

  /**
   * Drop Fastify's built-in `text/plain` parser.
   *
   * This supplements the explicit Origin check above. The cookie is `SameSite=None`
   * in production — it has to be, since the web app and this API are different
   * registrable domains — so the browser attaches it to cross-site requests and
   * an additional barrier is that a `<form>` cannot produce
   * `application/json`. `text/plain` it *can* produce, via
   * `enctype="text/plain"`, and that needs no preflight and no JavaScript.
   *
   * With the parser present, a malicious page could submit such a form to
   * `POST /episodes/:id/transcribe` — a route that reads no body at all, so a
   * junk payload does not stop it — and spend a signed-in visitor's AI quota
   * and the operator's Groq budget. The same held for `/ai/brief` and
   * `/ai/chapters`. Routes that *do* read a body were already safe by accident,
   * since a string fails their Zod parse; that is not a property worth relying
   * on when the next body-less route would silently reintroduce the hole.
   *
   * Removed rather than made to reject, so the answer is Fastify's own 415
   * before any handler, hook, or database call runs.
   */
  app.removeContentTypeParser('text/plain');

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
