import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiUsage, userApiKeys } from "@/lib/db/schema";
import { decryptApiKey } from "@/lib/crypto/api-keys";
import {
  byokLlmConfig,
  byokSttConfig,
  dailyQuota,
  defaultLlmChain,
  defaultSttConfig,
  type AiTier,
  type HostedSttProvider,
  type LlmConfig,
  type LlmProvider,
  type SttConfig,
} from "./config";

/**
 * Decides which tier serves a request and enforces the free-tier allowance.
 *
 * Quota state lives server-side in a table the client cannot read or write —
 * RLS denies `ai_usage` to everyone but the service role — because a counter
 * the browser can edit is not a quota.
 */

export type QuotaKind = "jobs" | "qa";

export type TierDecision =
  /**
   * `llm` is the whole fallback chain, tried in order, not one chosen provider.
   * Free tiers have unrelated ceilings, so exhausting one is a reason to try
   * the next rather than to fail the request.
   */
  | { allowed: true; tier: AiTier; llm: LlmConfig[]; stt: SttConfig | null }
  | { allowed: false; reason: string; used: number; limit: number };

/** UTC day, so the reset time is the same everywhere rather than per-timezone. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Every key this user has stored, in the given preference order. */
async function getUserKeys(
  userId: string,
  providers: string[],
): Promise<{ provider: string; key: string }[]> {
  const rows = await db.query.userApiKeys.findMany({
    where: eq(userApiKeys.userId, userId),
  });

  const found: { provider: string; key: string }[] = [];
  for (const provider of providers) {
    const row = rows.find((r) => r.provider === provider);
    if (!row) continue;
    try {
      found.push({ provider, key: decryptApiKey(row.encryptedKey) });
    } catch {
      // A key that no longer decrypts (rotated secret, corrupted row) should
      // fall through to the free tier rather than break the feature.
      continue;
    }
  }
  return found;
}

async function getUserKey(
  userId: string,
  providers: string[],
): Promise<{ provider: string; key: string } | null> {
  return (await getUserKeys(userId, providers))[0] ?? null;
}

export async function getUsage(userId: string) {
  const row = await db.query.aiUsage.findFirst({
    where: and(eq(aiUsage.userId, userId), eq(aiUsage.day, today())),
  });
  const limits = dailyQuota();
  return {
    jobsUsed: row?.jobsUsed ?? 0,
    qaUsed: row?.qaUsed ?? 0,
    jobsLimit: limits.jobs,
    qaLimit: limits.qa,
  };
}

/**
 * Works out how a request should be served.
 *
 * A user with their own key skips the quota check entirely. Everyone else is
 * measured against the daily allowance before any provider is contacted, so we
 * never pay for a call we were going to reject.
 */
export async function resolveTier(
  userId: string,
  kind: QuotaKind,
): Promise<TierDecision> {
  // All of them, so someone who has added two keys gets failover between their
  // own providers — and never silently falls through to an operator-funded one,
  // which would bill the wrong person.
  const userLlm = await getUserKeys(userId, [
    "gemini",
    "nvidia",
    "openrouter",
    "deepseek",
    "openai",
    "anthropic",
  ]);

  if (userLlm.length > 0) {
    const userStt = await getUserKey(userId, ["groq", "openai"]);
    return {
      allowed: true,
      tier: "byok",
      llm: userLlm.map((k) => byokLlmConfig(k.provider as LlmProvider, k.key)),
      stt: userStt
        ? byokSttConfig(userStt.provider as HostedSttProvider, userStt.key)
        : defaultSttConfig(),
    };
  }

  const llm = defaultLlmChain();
  if (llm.length === 0) {
    return {
      allowed: false,
      reason:
        "AI features aren't configured on this server yet. Add your own API key in Settings to use them now.",
      used: 0,
      limit: 0,
    };
  }

  const usage = await getUsage(userId);
  const used = kind === "jobs" ? usage.jobsUsed : usage.qaUsed;
  const limit = kind === "jobs" ? usage.jobsLimit : usage.qaLimit;

  if (used >= limit) {
    return {
      allowed: false,
      reason:
        kind === "jobs"
          ? `You've used all ${limit} free AI generations for today. Add your own API key in Settings for unlimited use, or come back tomorrow.`
          : `You've asked all ${limit} free questions for today. Add your own API key in Settings for unlimited use, or come back tomorrow.`,
      used,
      limit,
    };
  }

  return { allowed: true, tier: "default", llm, stt: defaultSttConfig() };
}

/**
 * Records one unit of usage. Only called after work actually succeeded — a
 * provider outage should not burn someone's daily allowance.
 */
export async function recordUsage(userId: string, kind: QuotaKind): Promise<void> {
  await db
    .insert(aiUsage)
    .values({
      userId,
      day: today(),
      jobsUsed: kind === "jobs" ? 1 : 0,
      qaUsed: kind === "qa" ? 1 : 0,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day],
      set: {
        jobsUsed:
          kind === "jobs" ? sql`${aiUsage.jobsUsed} + 1` : sql`${aiUsage.jobsUsed}`,
        qaUsed: kind === "qa" ? sql`${aiUsage.qaUsed} + 1` : sql`${aiUsage.qaUsed}`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}
