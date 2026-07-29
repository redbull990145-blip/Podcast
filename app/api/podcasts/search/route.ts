import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { searchPodcasts } from "@/lib/podcasts/search";

/** node runtime: the PodcastIndex signature uses node:crypto. */
export const runtime = "nodejs";

/**
 * Proxies catalogue search so the PodcastIndex key/secret never reach the
 * browser. Results are cached briefly at the edge — the same few queries get
 * typed constantly and neither catalogue changes minute to minute.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const term = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (term.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const results = await searchPodcasts(term, 24);

  return NextResponse.json(
    { results },
    {
      headers: {
        "Cache-Control": "private, max-age=300, stale-while-revalidate=600",
      },
    },
  );
}
