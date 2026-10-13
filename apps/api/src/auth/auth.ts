/**
 * Authentication.
 *
 * Email and password, with sessions in Postgres. Two clients consume this and
 * they authenticate differently, which the configuration has to account for:
 *
 *  - **Web** uses an httpOnly cookie. JavaScript cannot read it, so an XSS bug
 *    cannot exfiltrate the session.
 *  - **Android** has no cookie jar worth relying on, so it sends the session
 *    token as a bearer header and stores it in the OS keystore.
 *
 * Both resolve to the same `sessions` row; only the transport differs.
 */

import { schema, type Database } from '@cue/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, emailOTP } from 'better-auth/plugins';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.ts';
import { sendOtpEmail } from './email.ts';

export type Auth = ReturnType<typeof createAuth>;

/**
 * How long a verification code lasts.
 *
 * Ten minutes rather than the library's five: the code arrives by email, and
 * mail is not instant. A provider queue, a spam filter and a phone that fetches
 * on a schedule can easily eat three or four minutes between us sending and a
 * person reading, and a code that expires while it is still in transit is
 * indistinguishable from one that never worked.
 */
const OTP_EXPIRES_SEC = 10 * 60;

export function createAuth(db: Database, config: Config, log: FastifyBaseLogger) {
  const email = config.email;
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      // Our tables are plural, matching the rest of the schema.
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
      },
    }),

    secret: config.authSecret,
    baseURL: config.authUrl,
    basePath: '/auth',

    emailAndPassword: {
      enabled: true,
      // 8 is the floor NIST recommends; complexity rules push people toward
      // predictable substitutions rather than longer passwords.
      minPasswordLength: 8,
      maxPasswordLength: 256,
      /**
       * Gated on there being a mail provider, not hardcoded either way.
       *
       * With `RESEND_API_KEY` set this is the real thing: an unverified account
       * cannot sign in until it has entered the code. Without a key there is no
       * way to deliver one, and requiring verification anyway would lock every
       * new account out of the app it just created — with no recourse, since
       * "resend" would fail identically. So an unconfigured deployment keeps
       * working exactly as it did before, and `server.ts` says so at boot.
       */
      requireEmailVerification: email !== null,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      // Slide the expiry when a session is used inside this window, so an
      // active listener is never signed out mid-episode.
      updateAge: 60 * 60 * 24,
      cookieCache: {
        // A signed cache cookie outlives revocation/expiry in the sessions table.
        // Always resolve the current row, including cookies from older releases.
        enabled: false,
      },
    },

    plugins: [
      // Android sends `Authorization: Bearer <token>` instead of a cookie.
      bearer(),

      /**
       * Verification by six-digit code rather than a clickable link.
       *
       * A link has to land somewhere, and this project ships a web app *and* an
       * Android app from one API. Getting a tapped link back into the native app
       * means deep links, an intent filter, and a web fallback for the times the
       * link opens in a browser anyway — real work, all of it platform-specific,
       * and all of it able to break silently on one platform while the other
       * looks fine. A code is typed into whichever app the person is already
       * holding, so both clients share one flow and one implementation.
       *
       * Only registered when mail can actually be sent. Registering it without a
       * provider would publish `/auth/email-otp/*` endpoints that accept a
       * request and then never deliver anything.
       */
      ...(email
        ? [
            emailOTP({
              otpLength: 6,
              expiresIn: OTP_EXPIRES_SEC,
              /**
               * Send the code as part of sign-up, so the person moves straight
               * from the form to entering it. Without this the account is
               * created unverified and nothing is sent until something asks —
               * which, with `requireEmailVerification` on, is a dead end.
               */
              sendVerificationOnSignUp: true,
              /**
               * Make *the* email-verification flow this one. Better Auth
               * otherwise keeps its own link-based verification alongside the
               * OTP endpoints, which would mean two ways to verify an address,
               * only one of which is implemented here.
               */
              overrideDefaultEmailVerification: true,
              /**
               * Hashed at rest. A code is a bearer credential for the minutes it
               * lives, and the `verifications` table is not a place to keep one
               * in plaintext — the same reasoning as `ai/crypto.ts` for provider
               * keys, just with a much shorter fuse.
               */
              storeOTP: 'hashed',
              /**
               * Three tries per code. Six digits is a million combinations, but
               * an attacker does not need many when the same code stays valid
               * for ten minutes; the attempt ceiling is what makes the length
               * sufficient rather than merely plausible.
               */
              allowedAttempts: 3,
              async sendVerificationOTP({ email: to, otp, type }) {
                await sendOtpEmail({
                  config: email,
                  to,
                  otp,
                  purpose: type,
                  expiresInSec: OTP_EXPIRES_SEC,
                  log,
                });
              },
            }),
          ]
        : []),
    ],

    advanced: {
      /**
       * Cookie policy, which differs by environment for a reason that is easy
       * to get backwards:
       *
       * In development the web app is `localhost:3000` and the API is
       * `localhost:8080`. Different *origins*, but the same **site** — SameSite
       * is computed from the registrable domain and ignores the port entirely.
       * So `lax` is both correct and sufficient, and `none` would be actively
       * broken: browsers reject a `SameSite=None` cookie that is not also
       * `Secure`, and dev runs over plain http. The cookie would be silently
       * dropped and every sign-in would appear to succeed and do nothing.
       *
       * In production the two may genuinely be cross-site (Vercel and Render
       * are different registrable domains), which needs `none` — and there the
       * connection is HTTPS, so `secure` is satisfiable.
       */
      defaultCookieAttributes: {
        sameSite: config.isProduction ? 'none' : 'lax',
        secure: config.isProduction,
        httpOnly: true,
      },
    },

    trustedOrigins: config.corsOrigins,
  });
}
