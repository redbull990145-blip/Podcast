/**
 * Whose key pays, and what it costs them.
 *
 * Two funding routes, and the difference between them is the whole design:
 *
 *  - **Their own key.** Unmetered, because it is their money. We never count
 *    it, never cap it, and never store it in a readable form.
 *  - **The operator's key.** Metered per user per day, because it is one shared
 *    free tier and one enthusiastic user would otherwise spend all of it before
 *    lunch.
 *
 * Everything else follows from that. `resolve` returns which route applied so
 * error messages can be specific — "your key was rejected" and "the shared
 * allowance is spent" are different problems with different fixes, and a
 * generic failure would leave the user unable to tell which one they had.
 */

import { aiUsage, userApiKeys } from '@cue/db';
import type { AiQuota } from '@cue/types';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.ts';
import { decryptSecret } from './crypto.ts';

export type Funding = {
  key: string;
  /** True when the user's own key is paying, which means no metering. */
  byok: boolean;
};

/**
 * The UTC day, as `YYYY-MM-DD`.
 *
 * Deliberately not the user's local day. Per-user timezones would mean storing
 * one, keeping it current as people travel, and having the quota reset at a
 * different instant for everybody — for a feature whose entire user-visible
 * surface is one number.
 */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The user's own key, decrypted for a single call, or null. */
async function userKey(app: FastifyInstance, userId: string): Promise<string | null> {
  const secret = app.config.ai.encryptionSecret;
  if (!secret) return null;

  const [row] = await app.db
    .select()
    .from(userApiKeys)
    .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, 'groq')))
    .limit(1);

  if (!row) return null;

  // Null here means the row cannot be decrypted — a rotated encryption secret,
  // most likely. Falling through to the operator key keeps the feature working
  // while the user re-saves theirs, which beats a hard failure they cannot
  // diagnose.
  return decryptSecret(row.secret, secret);
}

/**
 * Decide who pays for this call, and meter it if it is the operator.
 *
 * Returns a `settle` callback rather than just a key. The quota is consumed
 * *before* the request goes out — checking first and incrementing after is a
 * race that lets concurrent requests both pass a limit of one — and refunded if
 * the provider never did the work. Charging someone for our own upstream outage
 * is the kind of small unfairness that erodes trust in a quota entirely.
 */
export async function resolve(
  app: FastifyInstance,
  userId: string,
): Promise<Funding & { settle: (outcome: 'ok' | 'failed') => Promise<void> }> {
  const own = await userKey(app, userId);

  if (own) {
    // Recorded for the Settings screen to show the key is live, and to make an
    // abandoned key visible later. Not awaited into the critical path.
    void app.db
      .update(userApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, 'groq')))
      .catch(() => undefined);

    return { key: own, byok: true, settle: async () => undefined };
  }

  const operator = app.config.ai.operatorKey;

  if (!operator) {
    throw new AppError(
      'bad_request',
      'AI features need a Groq API key. Add one in Settings — the free tier is enough.',
    );
  }

  const day = utcDay();
  const limit = app.config.ai.dailyQuota;

  /**
   * Claim one unit atomically.
   *
   * The upsert increments and reports the new total in a single statement, so
   * two simultaneous requests get 1 and 2 rather than both reading 0.
   */
  const [row] = await app.db
    .insert(aiUsage)
    .values({ userId, day, count: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day],
      set: { count: sql`${aiUsage.count} + 1` },
    })
    .returning({ count: aiUsage.count });

  const used = row?.count ?? limit + 1;

  if (used > limit) {
    await refund(app, userId, day);
    throw new AppError(
      'rate_limited',
      `That is your ${limit} AI requests for today. Add your own Groq key in Settings for unlimited use — the free tier covers this easily.`,
      { retryAfterSec: secondsUntilUtcMidnight() },
    );
  }

  return {
    key: operator,
    byok: false,
    settle: async (outcome) => {
      if (outcome === 'failed') await refund(app, userId, day);
    },
  };
}

/**
 * Whose key pays, without touching the quota.
 *
 * Split out for work that is charged when it is *asked for* and run later by
 * something else. A transcription claims its quota when it is queued — that is
 * what stops one person queueing a hundred episodes — but the key it runs with
 * has to be resolved when a worker actually picks it up, in a different process
 * from the one that took the payment, and possibly after a restart.
 *
 * A key is never stored on the job for the same reason it is encrypted at rest:
 * a credential that bills someone real money does not belong in a queue row.
 * Deriving it again costs one indexed read and a decrypt.
 */
export async function keyFor(
  app: FastifyInstance,
  userId: string,
): Promise<Funding> {
  const own = await userKey(app, userId);
  if (own) return { key: own, byok: true };

  const operator = app.config.ai.operatorKey;
  if (!operator) {
    throw new AppError(
      'bad_request',
      'AI features need a Groq API key. Add one in Settings — the free tier is enough.',
    );
  }

  return { key: operator, byok: false };
}

/**
 * Claim one unit against a user's day, or throw if they are out.
 *
 * Returns the day it was charged to so a refund can find it later. Recomputing
 * `utcDay()` at refund time would miss for any job that crossed midnight
 * between being queued and failing — rare, but it would quietly hand out a
 * credit on a day nobody was charged for.
 */
export async function claimQuota(
  app: FastifyInstance,
  userId: string,
): Promise<{ metered: boolean; day: string | null }> {
  // Their own key is their own bill: never counted, never capped.
  const own = await userKey(app, userId);
  if (own) return { metered: false, day: null };

  if (!app.config.ai.operatorKey) {
    throw new AppError(
      'bad_request',
      'AI features need a Groq API key. Add one in Settings — the free tier is enough.',
    );
  }

  const day = utcDay();
  const limit = app.config.ai.dailyQuota;

  const [row] = await app.db
    .insert(aiUsage)
    .values({ userId, day, count: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day],
      set: { count: sql`${aiUsage.count} + 1` },
    })
    .returning({ count: aiUsage.count });

  const used = row?.count ?? limit + 1;

  if (used > limit) {
    await refund(app, userId, day);
    throw new AppError(
      'rate_limited',
      `That is your ${limit} AI requests for today. Add your own Groq key in Settings for unlimited use — the free tier covers this easily.`,
      { retryAfterSec: secondsUntilUtcMidnight() },
    );
  }

  return { metered: true, day };
}

/**
 * Give a claimed unit back.
 *
 * Exported because the refund may happen in a different process than the claim
 * — a worker failing a job the API queued. The previous design held this as a
 * closure, which is exactly the state a restart destroys: the work was charged
 * for, the job died, and nobody was ever credited.
 */
export async function refundQuota(
  app: FastifyInstance,
  userId: string,
  day: string,
): Promise<void> {
  await refund(app, userId, day);
}

async function refund(app: FastifyInstance, userId: string, day: string): Promise<void> {
  await app.db
    .update(aiUsage)
    // Floored at zero: a refund for a call that was never charged (a failure
    // raised before the claim) must not hand out free credit.
    .set({ count: sql`greatest(${aiUsage.count} - 1, 0)` })
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.day, day)))
    .catch(() => {
      // A lost refund costs the user one request out of a daily allowance that
      // resets anyway. Failing their actual request over it would be worse.
    });
}

function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

/** What the Settings screen and the AI panel show before spending anything. */
export async function quotaFor(app: FastifyInstance, userId: string): Promise<AiQuota> {
  const secret = app.config.ai.encryptionSecret;

  const [keyRow] = secret
    ? await app.db
        .select({ hint: userApiKeys.hint })
        .from(userApiKeys)
        .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, 'groq')))
        .limit(1)
    : [];

  const [usageRow] = await app.db
    .select({ count: aiUsage.count })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.day, utcDay())))
    .limit(1);

  const byok = Boolean(keyRow);
  const used = usageRow?.count ?? 0;
  const limit = app.config.ai.dailyQuota;

  return {
    byok,
    hint: keyRow?.hint ?? null,
    used,
    limit,
    // Meaningless under BYOK, and reported as the limit rather than as a
    // countdown so a client that renders it unconditionally cannot imply a cap
    // that does not apply.
    remaining: byok ? limit : Math.max(0, limit - used),
    operatorAvailable: app.config.ai.operatorKey !== null,
  };
}
