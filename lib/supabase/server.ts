import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 *
 * Must be created per request — never hoisted to a module-level singleton,
 * since it closes over the current request's cookies.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * The subset of the user the app actually reads.
 *
 * Narrow on purpose: it is exactly what a verified access token carries, so
 * establishing who someone is never requires a call to the auth server.
 */
export type AuthenticatedUser = {
  id: string;
  email: string | null;
  user_metadata: Record<string, unknown>;
};

/**
 * Returns the authenticated user, or null.
 *
 * Uses `getClaims()`, which verifies the access token's signature against the
 * project's published public key (JWKS, fetched once and cached) instead of
 * asking the auth server who the bearer is. Both answers are cryptographically
 * sound — a forged or tampered token fails local verification exactly as it
 * would remotely — but one of them costs a network round trip and the other
 * does not. Measured against this project's auth host that round trip was
 * ~305ms, and it was happening twice per navigation: once in the proxy and
 * once here. On a page like Settings, which does no other work, it was the
 * entire load time.
 *
 * `getSession()` would be the wrong shortcut: it reads the cookie and trusts it
 * without checking the signature at all.
 *
 * The trade-off is real and worth naming. A token revoked server-side — signed
 * out on another device, user deleted or banned — stays accepted here until it
 * expires, up to the access-token lifetime. That is the standard property of
 * any stateless JWT check, and the window is bounded by the project's token
 * TTL. If the project ever moves back to a legacy shared-secret (HS256) key,
 * `getClaims()` falls back to a network verification on its own, so this stays
 * correct rather than silently becoming unsafe.
 *
 * Still wrapped in React's `cache`: the JWKS lookup and verification are cheap
 * but not free, and the layout plus every page inside it all ask.
 */
export const getUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  const claims = data?.claims;
  if (error || !claims?.sub) return null;

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    user_metadata: (claims.user_metadata ?? {}) as Record<string, unknown>,
  };
});
