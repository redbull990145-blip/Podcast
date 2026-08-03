import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { playbackState } from "@/lib/db/schema";
import { listEpisodes } from "@/lib/podcasts/ingest";
import { isUuid } from "@/lib/api/validation";
import { stripHtml } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * A page of a show's episodes, for "show more" on the show page.
 *
 * The page itself renders the first batch server-side, which is what makes the
 * show usable on first paint. This exists so the rest of a long back catalogue
 * is reachable without shipping a thousand rows into the initial HTML — a show
 * like BibleProject has 535 episodes, and rendering all of them up front costs
 * more than every other page in the app put together.
 *
 * Deliberately mirrors what the page does rather than sharing a helper with it:
 * the two differ only in `offset`, and a helper spanning a server component and
 * a route would have to take the user, the db handle and the strip step as
 * arguments to save four lines.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Unknown podcast." }, { status: 404 });
  }

  const url = new URL(request.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  // Bounded so a hand-edited query string cannot ask for the whole table.
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));

  const rows = await listEpisodes(id, limit, offset);

  // One query for the whole page's progress rather than one per row, and
  // filtered by user in SQL so the database returns this user's rows only.
  const progressRows =
    rows.length > 0
      ? await db
          .select({
            episodeId: playbackState.episodeId,
            positionSeconds: playbackState.positionSeconds,
            played: playbackState.played,
          })
          .from(playbackState)
          .where(
            and(
              eq(playbackState.userId, user.id),
              inArray(
                playbackState.episodeId,
                rows.map((e) => e.id),
              ),
            ),
          )
      : [];

  const progressByEpisode = new Map(
    progressRows.map((r) => [
      r.episodeId,
      { positionSeconds: Number(r.positionSeconds), played: r.played },
    ]),
  );

  return NextResponse.json({
    episodes: rows.map((episode) => ({
      // Stripped here so the markup never reaches the browser, exactly as the
      // page does it.
      episode: { ...episode, description: stripHtml(episode.description) },
      progress: progressByEpisode.get(episode.id),
    })),
  });
}
