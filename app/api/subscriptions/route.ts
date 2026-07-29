import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { ingestFeed } from "@/lib/podcasts/ingest";
import { isSafeFeedUrl } from "@/lib/rss/url-guard";

export const runtime = "nodejs";

/** Shows the signed-in user follows, with enough detail to render the library. */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rows = await db.query.subscriptions.findMany({
    where: eq(subscriptions.userId, user.id),
    with: { podcast: true },
    orderBy: (s, { desc }) => [desc(s.subscribedAt)],
  });

  return NextResponse.json({
    subscriptions: rows.map((r) => ({
      podcast: r.podcast,
      subscribedAt: r.subscribedAt,
      perShowSettings: r.perShowSettings,
    })),
  });
}

/**
 * Subscribes by feed URL.
 *
 * Takes a URL rather than an internal id so that "add by RSS" and "subscribe
 * from search" are the same code path — a show found in a catalogue and a show
 * pasted in by hand are identical once we have the feed.
 */
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    feedUrl?: string;
    itunesId?: number | null;
    podcastindexId?: number | null;
  } | null;

  const feedUrl = body?.feedUrl?.trim();
  if (!feedUrl) {
    return NextResponse.json({ error: "A feed URL is required." }, { status: 400 });
  }
  if (!isSafeFeedUrl(feedUrl)) {
    return NextResponse.json(
      { error: "That doesn't look like a reachable feed URL." },
      { status: 400 },
    );
  }

  const ingested = await ingestFeed(feedUrl, {
    itunesId: body?.itunesId,
    podcastindexId: body?.podcastindexId,
  });

  if (ingested.status === "error") {
    return NextResponse.json({ error: ingested.message }, { status: 422 });
  }

  await db
    .insert(subscriptions)
    .values({ userId: user.id, podcastId: ingested.podcast.id })
    // Subscribing twice is a no-op, not an error — the button may be double-tapped
    // or the same show reached from two places.
    .onConflictDoNothing();

  return NextResponse.json({
    podcast: ingested.podcast,
    episodeCount: ingested.episodeCount,
  });
}

/** Unsubscribes. Playback history is kept — resubscribing restores your place. */
export async function DELETE(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const podcastId = request.nextUrl.searchParams.get("podcastId");
  if (!podcastId) {
    return NextResponse.json({ error: "A podcast id is required." }, { status: 400 });
  }

  await db
    .delete(subscriptions)
    .where(
      and(eq(subscriptions.userId, user.id), eq(subscriptions.podcastId, podcastId)),
    );

  return NextResponse.json({ ok: true });
}
