import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { episodes } from "@/lib/db/schema";
import { fetchChapters } from "@/lib/rss/parse-feed";

export const runtime = "nodejs";

/**
 * Resolves chapters for an episode, caching the result on the row.
 *
 * <podcast:chapters> points at a separate JSON document, so it is fetched the
 * first time someone opens an episode rather than during feed ingestion —
 * pulling an extra document for every item in a 500-episode feed would be
 * wasteful when most are never opened.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;

  const episode = await db.query.episodes.findFirst({
    where: eq(episodes.id, id),
    columns: {
      id: true,
      chapters: true,
      chaptersSource: true,
      chaptersUrl: true,
    },
  });

  if (!episode) {
    return NextResponse.json({ error: "Unknown episode." }, { status: 404 });
  }

  // Already resolved — from the feed, or from a previous AI generation.
  if (episode.chapters) {
    return NextResponse.json({
      chapters: episode.chapters,
      source: episode.chaptersSource,
    });
  }

  // No chapters published. Phase 3 offers to generate them here instead.
  if (!episode.chaptersUrl) {
    return NextResponse.json({ chapters: null, source: null });
  }

  const chapters = await fetchChapters(episode.chaptersUrl);
  if (!chapters) {
    return NextResponse.json({ chapters: null, source: null });
  }

  await db
    .update(episodes)
    .set({ chapters, chaptersSource: "feed" })
    .where(eq(episodes.id, id));

  return NextResponse.json({ chapters, source: "feed" });
}
