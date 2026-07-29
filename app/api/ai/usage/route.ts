import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { userApiKeys } from "@/lib/db/schema";
import { getUsage } from "@/lib/ai/quota";
import { isDefaultTierAvailable, isDefaultTranscriptionAvailable } from "@/lib/ai/config";

export const runtime = "nodejs";

/**
 * What's left of today's free allowance, and whether the user is on it at all.
 *
 * Drives the "2 of 5 free generations left today" indicator — being explicit
 * about the limit beats letting people discover it by hitting an error.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const keys = await db.query.userApiKeys.findMany({
    where: eq(userApiKeys.userId, user.id),
    columns: { provider: true },
  });

  const hasOwnKey = keys.some((k) =>
    ["openrouter", "deepseek", "openai", "anthropic"].includes(k.provider),
  );

  const usage = await getUsage(user.id);

  return NextResponse.json({
    tier: hasOwnKey ? "byok" : "default",
    hasOwnKey,
    available: hasOwnKey || isDefaultTierAvailable(),
    transcriptionAvailable:
      keys.some((k) => ["openai", "groq"].includes(k.provider)) ||
      isDefaultTranscriptionAvailable(),
    ...usage,
  });
}
