import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Routes that require an authenticated user. */
const PROTECTED_PREFIXES = [
  "/library",
  "/discover",
  "/queue",
  "/downloads",
  "/settings",
  "/podcast",
  "/episode",
];

/**
 * Refreshes the Supabase auth token on every request and redirects
 * unauthenticated users away from the app shell.
 *
 * The response object returned here must be the one that reaches the browser —
 * it carries the refreshed auth cookies.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  /*
   * Do not run code between createServerClient and this call — a stray await
   * here is a common source of random logouts.
   *
   * `getClaims()` rather than `getUser()`: it still refreshes an expired token
   * (which is this function's real job, and why the response object below has
   * to be the one that reaches the browser), but it establishes identity by
   * verifying the token's signature locally against the project's public key
   * instead of asking the auth server. That removes one ~305ms round trip from
   * every single request that matches the proxy — page loads, prefetches and
   * all. See lib/supabase/server.ts for the trade-off this accepts.
   */
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? data.claims : null;

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/library";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
