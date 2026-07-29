import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { parseOpml } from "@/lib/opml/opml";
import { ingestFeed } from "@/lib/podcasts/ingest";
import { isSafeFeedUrl } from "@/lib/rss/url-guard";

export const runtime = "nodejs";

/** 2 MB is far more than any real subscription list. */
const MAX_OPML_BYTES = 2 * 1024 * 1024;

/**
 * Vercel Hobby kills a function at 10 seconds, and each feed has to be fetched
 * and parsed. Importing is therefore chunked: the client posts the file, gets
 * back the full list plus results for the first slice, and re-posts the
 * remaining feed URLs until it is done — with a visible progress bar rather
 * than a spinner that dies at ten seconds.
 */
const FEEDS_PER_REQUEST = 5;

export type ImportOutcome = {
  feedUrl: string;
  title: string | null;
  status: "added" | "failed";
  error?: string;
};

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const contentType = request.headers.get("content-type") ?? "";
  let feedUrls: string[];
  let totalFound: number | undefined;

  if (contentType.includes("application/json")) {
    // Continuation: the client is sending back the URLs still to process.
    const body = (await request.json().catch(() => null)) as {
      feedUrls?: string[];
    } | null;
    feedUrls = Array.isArray(body?.feedUrls) ? body.feedUrls : [];
  } else {
    // First call: the OPML file itself.
    const text = await request.text();
    if (text.length > MAX_OPML_BYTES) {
      return NextResponse.json({ error: "That file is too large." }, { status: 413 });
    }

    const outlines = parseOpml(text);
    if (outlines.length === 0) {
      return NextResponse.json(
        { error: "No podcast subscriptions found in that file." },
        { status: 422 },
      );
    }
    feedUrls = outlines.map((o) => o.feedUrl);
    totalFound = feedUrls.length;
  }

  const batch = feedUrls.slice(0, FEEDS_PER_REQUEST);
  const remaining = feedUrls.slice(FEEDS_PER_REQUEST);
  const results: ImportOutcome[] = [];

  for (const feedUrl of batch) {
    if (!isSafeFeedUrl(feedUrl)) {
      results.push({
        feedUrl,
        title: null,
        status: "failed",
        error: "Unreachable feed URL.",
      });
      continue;
    }

    // One dead feed in a 200-show export must not fail the whole import.
    try {
      const ingested = await ingestFeed(feedUrl);
      if (ingested.status === "error") {
        results.push({
          feedUrl,
          title: null,
          status: "failed",
          error: ingested.message,
        });
        continue;
      }

      await db
        .insert(subscriptions)
        .values({ userId: user.id, podcastId: ingested.podcast.id })
        .onConflictDoNothing();

      results.push({
        feedUrl,
        title: ingested.podcast.title,
        status: "added",
      });
    } catch {
      results.push({
        feedUrl,
        title: null,
        status: "failed",
        error: "Couldn't read that feed.",
      });
    }
  }

  return NextResponse.json({
    totalFound,
    results,
    remaining,
    done: remaining.length === 0,
  });
}
