import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { userApiKeys } from "@/lib/db/schema";
import { encryptApiKey, keyHint } from "@/lib/crypto/api-keys";

export const runtime = "nodejs";

const ALLOWED_PROVIDERS = ["openrouter", "deepseek", "openai", "anthropic", "groq"];

/**
 * Bring-your-own-key management.
 *
 * The stored key is never returned by any endpoint, in any form beyond its last
 * four characters. Adding a key is write-only from the client's perspective:
 * you can replace it or delete it, but you cannot read it back.
 */

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rows = await db.query.userApiKeys.findMany({
    where: eq(userApiKeys.userId, user.id),
    // Explicit column list so the ciphertext cannot leak through a later edit
    // that adds a field to the response.
    columns: { provider: true, keyHint: true, createdAt: true },
  });

  return NextResponse.json({ keys: rows });
}

export async function PUT(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    provider?: string;
    apiKey?: string;
  } | null;

  const provider = body?.provider?.toLowerCase();
  const apiKey = body?.apiKey?.trim();

  if (!provider || !ALLOWED_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "Unsupported provider." }, { status: 400 });
  }
  if (!apiKey || apiKey.length < 16) {
    return NextResponse.json({ error: "That doesn't look like an API key." }, {
      status: 400,
    });
  }

  try {
    await db
      .insert(userApiKeys)
      .values({
        userId: user.id,
        provider,
        encryptedKey: encryptApiKey(apiKey),
        keyHint: keyHint(apiKey),
      })
      .onConflictDoUpdate({
        target: [userApiKeys.userId, userApiKeys.provider],
        set: {
          encryptedKey: encryptApiKey(apiKey),
          keyHint: keyHint(apiKey),
        },
      });
  } catch (err) {
    // Most likely cause is a missing or malformed encryption secret, which is
    // an operator problem, not something the user can fix.
    console.error("Failed to store API key", err);
    return NextResponse.json(
      { error: "Couldn't save that key. The server may be misconfigured." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, provider, keyHint: keyHint(apiKey) });
}

export async function DELETE(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const provider = request.nextUrl.searchParams.get("provider");
  if (!provider) {
    return NextResponse.json({ error: "A provider is required." }, { status: 400 });
  }

  await db
    .delete(userApiKeys)
    .where(
      and(eq(userApiKeys.userId, user.id), eq(userApiKeys.provider, provider)),
    );

  return NextResponse.json({ ok: true });
}
