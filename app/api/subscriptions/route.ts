import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { ingestFeed } from "@/lib/podcasts/ingest";
import { isSafeFeedUrl, normaliseFeedUrl } from "@/lib/rss/url-guard";

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

  /*
   * Normalised before anything else touches it, so the scheme this fills in is
   * the one that gets fetched and the one that gets stored. Validating a
   * completed URL and then ingesting the raw one would put a scheme-less
   * address in the database, where every later fetch would have to repair it
   * again — and the duplicate check would miss a show already followed.
   */
  const feedUrl = normaliseFeedUrl(body?.feedUrl ?? "");
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

  /*
   * A feed with items but no audio is a blog's, not a podcast's.
   *
   * It parses perfectly — title, description, artwork, categories all present —
   * so everything downstream treats it as a real show, and the only symptom is
   * a subscription that is permanently empty. `blog.apaonline.org/feed` is
   * exactly this: ten articles, zero enclosures, and a following you cannot
   * explain. Refusing at the point of subscribing is the only moment the
   * explanation is useful.
   *
   * Only ever refuses when a fetch actually happened and found items. A cache
   * hit reports no `feed`, and a genuinely new show with nothing published yet
   * has no items to judge — neither should be blocked.
   */
  if (
    ingested.episodeCount === 0 &&
    ingested.feed &&
    ingested.feed.audioItems === 0 &&
    ingested.feed.totalItems > 0
  ) {
    return NextResponse.json(
      {
        error:
          "That feed has articles rather than audio, so there's nothing to play. It's most likely the site's blog feed — look for its podcast feed instead.",
      },
      { status: 422 },
    );
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
