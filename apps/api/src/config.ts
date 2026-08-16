/**
 * Environment, validated once at boot.
 *
 * The API refuses to start on bad configuration rather than failing on the
 * first request that happens to need a missing variable. A server that boots
 * "successfully" and then 500s on `/podcasts` because `DATABASE_URL` was
 * misspelled is strictly worse than one that never came up.
 */

import { z } from 'zod';

/**
 * Treat a blank value as absent.
 *
 * `KEY=` with nothing after it is how every hand-written `.env` starts, and to
 * the person who typed it that means "not filled in yet". Zod's `.optional()`
 * accepts only `undefined`, so without this a blank line is a *present* value
 * that fails its own rule — and the API refuses to boot complaining that a
 * string is under 16 characters, which reads as a bug rather than as a
 * variable nobody has set. Blank defaults were reaching `CORS_ORIGINS` the
 * same way and turning "allow localhost" into "allow nothing".
 */
function blankAsUnset<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema);
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  /** 0.0.0.0 so a physical Android device on the LAN can reach the dev server. */
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — see .env.example'),

  /**
   * Redis is optional. It is a cache and a rate limiter, never the source of
   * truth, so the API runs without it — degraded, not broken. That keeps local
   * development from requiring an account before the first request works.
   */
  REDIS_URL: blankAsUnset(z.url().optional()),
  REDIS_TOKEN: blankAsUnset(z.string().min(1).optional()),

  /**
   * PodcastIndex credentials. Optional in the same spirit as Redis — the app
   * runs without them, it just can't search. Browsing and playing a feed you
   * already know the URL of still works.
   */
  PODCASTINDEX_KEY: blankAsUnset(z.string().min(1).optional()),
  PODCASTINDEX_SECRET: blankAsUnset(z.string().min(1).optional()),

  /**
   * Signs session tokens. Rotating it invalidates every session, so it must be
   * stable across deploys. Optional only in development, where a fixed
   * throwaway keeps `npm run dev` working with no setup — production refuses
   * to start without a real one (checked below).
   */
  BETTER_AUTH_SECRET: blankAsUnset(z.string().min(16).optional()),
  /** Public origin of this API, used to build callback URLs. */
  BETTER_AUTH_URL: blankAsUnset(z.url().optional()),

  /** Comma-separated list of origins allowed to call this API from a browser. */
  CORS_ORIGINS: blankAsUnset(z.string().default('http://localhost:3000')),

  /**
   * How many proxies sit in front of this API.
   *
   * This is a security control, not a formality. Fastify's `trustProxy: true`
   * trusts the *entire* `X-Forwarded-For` chain and returns its leftmost entry —
   * which is written by the caller, so `request.ip` becomes whatever they say
   * it is, and every IP-keyed rate limit is bypassed by rotating a header. A
   * hop count instead makes `proxy-addr` walk back exactly this many trusted
   * hops and return the address the nearest trusted proxy actually observed.
   *
   * 1 is right for a single platform load balancer (Render, Koyeb, Fly). Behind
   * Cloudflare *and* a platform LB it is 2. Set it to 0 when nothing proxies
   * this server, so the socket address is used and headers are ignored entirely.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),

  /**
   * The operator's Groq key, which funds the free tier.
   *
   * Optional: without it the AI features still work, but only for users who
   * have added their own key. That is a coherent product — not a broken one —
   * so it must not stop the server booting.
   */
  GROQ_API_KEY: blankAsUnset(z.string().min(1).optional()),

  /**
   * Encrypts users' own API keys at rest.
   *
   * Rotating this makes every stored key undecryptable, which is why it is
   * checked for length here rather than being allowed to fail one call at a
   * time later. Without it, BYOK is refused outright rather than stored in
   * plaintext — a feature that is off is recoverable; a leaked key table is not.
   */
  API_KEY_ENCRYPTION_SECRET: blankAsUnset(z.string().min(16).optional()),

  /** Operator-key requests per user per UTC day. */
  AI_DAILY_QUOTA: z.coerce.number().int().min(0).default(20),

  /**
   * Resend API key, which is what makes email verification possible at all.
   *
   * Optional, and its absence is a supported configuration rather than a broken
   * one: without it the API cannot send a code, so it does not pretend to —
   * verification is left off and accounts work immediately. Requiring
   * verification with no way to deliver it would lock every new account out of
   * the app it just created, which is the one failure mode a person cannot
   * work around themselves.
   */
  RESEND_API_KEY: blankAsUnset(z.string().min(1).optional()),

  /**
   * The From address on verification mail.
   *
   * Defaults to Resend's shared sandbox sender, which needs no DNS and works
   * the moment a key exists — but only delivers to the address that owns the
   * Resend account. Real signups need a verified domain here, and the default
   * being visibly a test address is what makes that obvious before launch
   * rather than after the first person never receives their code.
   */
  EMAIL_FROM: blankAsUnset(z.string().min(3).default('Cue <onboarding@resend.dev>')),
});

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  host: string;
  databaseUrl: string;
  redis: { url: string; token: string } | null;
  podcastIndex: { key: string; secret: string } | null;
  corsOrigins: string[];
  /** Hop count for `proxy-addr`, or `false` to ignore forwarding headers. */
  trustProxy: number | false;
  authSecret: string;
  authUrl: string;
  ai: {
    /** The operator's key, or null when only BYOK is available. */
    operatorKey: string | null;
    /** Null disables BYOK entirely rather than storing keys unencrypted. */
    encryptionSecret: string | null;
    dailyQuota: number;
  };
  /**
   * Null when no mail provider is configured, which turns email verification
   * off rather than leaving it on with no way to deliver a code.
   */
  email: { apiKey: string; from: string } | null;
};

/**
 * A fixed development secret.
 *
 * Deliberately obvious rather than random: a random per-boot secret would sign
 * everyone out on every restart, and a plausible-looking constant might get
 * copied into a deploy. Production rejects it outright.
 */
const DEV_AUTH_SECRET = 'insecure-development-secret-do-not-use-in-production';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${problems}`);
  }

  const value = parsed.data;

  /**
   * A password with `%`, `/` or `@` in it has to be percent-encoded, and the
   * generated ones from Supabase and Neon routinely contain all three. Pasted
   * raw, the driver throws a bare `URI malformed` from inside
   * `decodeURIComponent` — no variable named, no file named, and nothing to
   * search for. Caught here so the message says which value and what to do.
   */
  if (!value.DATABASE_URL.startsWith('pglite:')) {
    const password = /^[a-z+]+:\/\/[^:/@]*:([^@]*)@/i.exec(value.DATABASE_URL)?.[1];
    if (password !== undefined) {
      try {
        decodeURIComponent(password);
      } catch {
        throw new Error(
          'DATABASE_URL password contains characters that must be percent-encoded ' +
            '(% → %25, / → %2F, @ → %40)',
        );
      }
    }
  }

  // The in-process dev database must never be reachable in production: it is
  // a file on the container's ephemeral disk, so it would silently discard
  // every user's library on the next deploy.
  if (value.NODE_ENV === 'production' && value.DATABASE_URL.startsWith('pglite:')) {
    throw new Error('DATABASE_URL must point at a real Postgres in production, not pglite:');
  }

  // A shipped default signing secret is the kind of thing that ends up in a
  // breach writeup, so production will not start without a real one.
  if (value.NODE_ENV === 'production' && !value.BETTER_AUTH_SECRET) {
    throw new Error('BETTER_AUTH_SECRET is required in production');
  }

  /**
   * Upstash publishes two endpoints and they are not interchangeable. The
   * `rediss://` connection string is the plain-Redis protocol one; we use the
   * REST client, which needs the `https://` URL from the same panel. Pasting
   * the wrong one parses as a perfectly valid URL and then fails on every
   * cache call at runtime, which reads as "the cache is broken" rather than
   * "the wrong line was copied".
   */
  if (value.REDIS_URL && !value.REDIS_URL.startsWith('https://')) {
    throw new Error(
      'REDIS_URL must be the Upstash REST endpoint (https://…upstash.io), not the rediss:// connection string',
    );
  }

  // Both halves or neither — a URL with no token fails at the first command,
  // which is a confusing way to find out the config was half-filled.
  const redis =
    value.REDIS_URL && value.REDIS_TOKEN
      ? { url: value.REDIS_URL, token: value.REDIS_TOKEN }
      : null;

  const podcastIndex =
    value.PODCASTINDEX_KEY && value.PODCASTINDEX_SECRET
      ? { key: value.PODCASTINDEX_KEY, secret: value.PODCASTINDEX_SECRET }
      : null;

  return {
    nodeEnv: value.NODE_ENV,
    isProduction: value.NODE_ENV === 'production',
    port: value.PORT,
    host: value.HOST,
    databaseUrl: value.DATABASE_URL,
    redis,
    podcastIndex,
    corsOrigins: value.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    // 0 means "nothing in front of me" — express it as `false` so Fastify
    // ignores forwarding headers rather than trusting zero hops of them.
    trustProxy: value.TRUST_PROXY_HOPS === 0 ? false : value.TRUST_PROXY_HOPS,
    authSecret: value.BETTER_AUTH_SECRET ?? DEV_AUTH_SECRET,
    authUrl: value.BETTER_AUTH_URL ?? `http://localhost:${value.PORT}`,
    ai: {
      operatorKey: value.GROQ_API_KEY ?? null,
      encryptionSecret: value.API_KEY_ENCRYPTION_SECRET ?? null,
      dailyQuota: value.AI_DAILY_QUOTA,
    },
    // The key is what decides this, not the From address: a From with no key
    // cannot send, and a key with the default From can.
    email: value.RESEND_API_KEY
      ? { apiKey: value.RESEND_API_KEY, from: value.EMAIL_FROM }
      : null,
  };
}
