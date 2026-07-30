import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import {
  listeningHistory,
  recommendationFeedback,
  subscriptions,
} from "@/lib/db/schema";
import { searchPodcasts } from "@/lib/podcasts/search";
import { ensureCatalogPodcast } from "@/lib/podcasts/ingest";
import {
  buildAffinity,
  rankCandidates,
  topCategories,
  type Candidate,
  type ListeningSignal,
} from "@/lib/recommender/score-candidates";

export const runtime = "nodejs";

/** History older than this says little about current taste and costs time to scan. */
const HISTORY_WINDOW_DAYS = 180;

/** Candidate searches to run. Each is one category, strongest affinity first. */
const CATEGORY_SEARCHES = 4;

/** Results per category search. The pool is then ranked as a whole. */
const RESULTS_PER_CATEGORY = 15;

/**
 * Personalised recommendations, with the reasoning attached.
 *
 * Everything here is either already in our database or a free catalogue search,
 * so this costs nothing per request and stays available whether or not any AI
 * provider is configured. The ranking is plain vector maths — see
 * lib/recommender/score-candidates.ts.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 86_400_000);

  const [history, following, feedback] = await Promise.all([
    db
      .select({
        event: listeningHistory.event,
        categories: listeningHistory.categorySnapshot,
        occurredAt: listeningHistory.occurredAt,
      })
      .from(listeningHistory)
      .where(
        and(eq(listeningHistory.userId, user.id), gte(listeningHistory.occurredAt, since)),
      )
      .orderBy(desc(listeningHistory.occurredAt))
      .limit(500),

    db.query.subscriptions.findMany({
      where: eq(subscriptions.userId, user.id),
      with: { podcast: { columns: { feedUrl: true, categories: true } } },
    }),

    db
      .select({
        podcastId: recommendationFeedback.podcastId,
        signal: recommendationFeedback.signal,
      })
      .from(recommendationFeedback)
      .where(eq(recommendationFeedback.userId, user.id)),
  ]);

  const affinity = buildAffinity(
    history.map(
      (h): ListeningSignal => ({
        event: h.event as ListeningSignal["event"],
        categories: h.categories,
        occurredAt: h.occurredAt,
      }),
    ),
    following.map((s) => ({
      categories: s.podcast.categories,
      subscribedAt: s.subscribedAt,
    })),
  );

  const categories = topCategories(affinity, CATEGORY_SEARCHES);

  if (categories.length === 0) {
    // Nothing to go on yet. Saying so is more honest — and more actionable —
    // than filling the page with whatever is popular this week.
    return NextResponse.json({ recommendations: [], categories: [], coldStart: true });
  }

  // Feeds to keep out of the results: everything followed, plus anything
  // explicitly rejected.
  const rejectedPodcastIds = feedback
    .filter((f) => f.signal === "thumbs_down" || f.signal === "not_interested")
    .map((f) => f.podcastId);

  const rejectedFeedUrls =
    rejectedPodcastIds.length > 0
      ? (
          await db.query.podcasts.findMany({
            where: (p) => inArray(p.id, rejectedPodcastIds),
            columns: { feedUrl: true },
          })
        ).map((p) => p.feedUrl)
      : [];

  // One search per top category, in parallel. searchPodcasts swallows its own
  // failures, so a catalogue being down means a smaller pool, not an error.
  const pools = await Promise.all(
    categories.map((category) => searchPodcasts(category, RESULTS_PER_CATEGORY)),
  );

  const byFeed = new Map<string, Candidate>();
  for (const pool of pools) {
    for (const result of pool) {
      if (!byFeed.has(result.feedUrl)) byFeed.set(result.feedUrl, result);
    }
  }

  const recommendations = rankCandidates({
    candidates: [...byFeed.values()],
    affinity,
    excludeFeedUrls: [...following.map((s) => s.podcast.feedUrl), ...rejectedFeedUrls],
    limit: 12,
  });

  return NextResponse.json({ recommendations, categories, coldStart: false });
}

/**
 * Records feedback on a recommendation so it stops (or keeps) being suggested.
 *
 * Identified by feed URL rather than id, because a recommended show usually
 * isn't in our catalogue yet — the stub written here is what gives it one.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    feedUrl?: string;
    title?: string;
    signal?: string;
    author?: string | null;
    artworkUrl?: string | null;
    categories?: string[];
  } | null;

  const allowed = ["thumbs_up", "thumbs_down", "not_interested"];
  if (!body?.feedUrl || !body.title || !body.signal || !allowed.includes(body.signal)) {
    return NextResponse.json(
      { error: "A feed URL, title and signal are required." },
      { status: 400 },
    );
  }

  const podcast = await ensureCatalogPodcast({
    feedUrl: body.feedUrl,
    title: body.title,
    author: body.author,
    artworkUrl: body.artworkUrl,
    categories: body.categories,
  });

  await db
    .insert(recommendationFeedback)
    .values({ userId: user.id, podcastId: podcast.id, signal: body.signal })
    .onConflictDoUpdate({
      target: [recommendationFeedback.userId, recommendationFeedback.podcastId],
      set: { signal: body.signal, createdAt: new Date() },
    });

  return NextResponse.json({ ok: true });
}
