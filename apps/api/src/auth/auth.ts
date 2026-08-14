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
import { bearer } from 'better-auth/plugins';
import type { Config } from '../config.ts';

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(db: Database, config: Config) {
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
      // No mail provider is wired up yet, so requiring verification would lock
      // every new account out of the app it just created.
      requireEmailVerification: false,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      // Slide the expiry when a session is used inside this window, so an
      // active listener is never signed out mid-episode.
      updateAge: 60 * 60 * 24,
      cookieCache: {
        // Cache the session on the request for a few seconds so a page making
        // several API calls does not hit the sessions table once per call.
        enabled: true,
        maxAge: 5 * 60,
      },
    },

    // Android sends `Authorization: Bearer <token>` instead of a cookie.
    plugins: [bearer()],

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
