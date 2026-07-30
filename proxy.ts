import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next 16 renamed the `middleware` file convention to `proxy`. The behaviour is
 * unchanged: refresh the Supabase session on every request and keep anonymous
 * visitors out of the app shell.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, image files, the service worker — none
     * of which need an auth refresh — and API routes.
     *
     * API routes are excluded because every one of them already calls
     * getUser() itself, and a Route Handler can write cookies, so it refreshes
     * an expired token perfectly well on its own. Running the proxy over them
     * too just added a second round-trip to Supabase's auth server on every
     * request — including the playback-position write that fires every ten
     * seconds while something is playing.
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
