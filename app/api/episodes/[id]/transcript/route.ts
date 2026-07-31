import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { episodes, transcripts, type TranscriptSegment } from "@/lib/db/schema";
import { fetchTranscript } from "@/lib/rss/transcript";
import { colabSttConfig } from "@/lib/ai/config";
import { estimateSeconds } from "@/lib/player/transcribe-stages";
import { isUuid } from "@/lib/api/validation";

export const runtime = "nodejs";

/**
 * Timed transcript for an episode, used to drive captions.
 *
 * Resolution order matters, because the cheapest source is also the best one:
 *
 *  1. Our cache. Shared across every user, so the first person to transcribe an
 *     episode pays for everyone.
 *  2. The publisher's own <podcast:transcript>. Free, instant, usually
 *     human-corrected — and cached into the same table so we only fetch it once.
 *  3. Nothing, and the client offers to spend AI quota on generating one.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Unknown episode." }, { status: 404 });
  }

  // Both together: the episode row is needed on every path now, because even a
  // cached transcript can be regenerated and the progress bar for that needs
  // the estimate. In parallel it costs the same round trip as the transcript
  // lookup alone.
  const [cached, episode] = await Promise.all([
    db.query.transcripts.findFirst({ where: eq(transcripts.episodeId, id) }),
    db.query.episodes.findFirst({
      where: eq(episodes.id, id),
      columns: { id: true, transcriptUrl: true, durationSeconds: true },
    }),
  ]);

  if (!episode) {
    return NextResponse.json({ error: "Unknown episode." }, { status: 404 });
  }

  /**
   * How long generating captions is likely to take, in seconds.
   *
   * Computed here rather than in the browser because only the server knows
   * both halves: the episode's real duration (the player only has whatever is
   * currently loaded, which may be a different episode or nothing at all) and
   * whether a developer's own GPU will serve this instead of a hosted
   * provider — an order-of-magnitude difference in speed.
   */
  const estimatedSeconds = estimateSeconds(
    episode.durationSeconds ?? 0,
    colabSttConfig() ? "local" : "hosted",
  );

  /**
   * The feed's own length, which the player compares the downloaded file
   * against to work out how much advertising was stitched in — see
   * captionOffsetFor. The browser can't derive it: `audio.duration` describes
   * the file it was served, ads and all, which is exactly the thing being
   * measured.
   */
  const publishedDuration = episode.durationSeconds;

  if (cached?.segments) {
    return NextResponse.json({
      segments: cached.segments as TranscriptSegment[],
      source: cached.source,
      estimatedSeconds,
      publishedDuration,
    });
  }

  if (!episode.transcriptUrl) {
    // A transcript with no timings can't drive captions, but it does mean the
    // episode has already been transcribed — say so rather than offering to
    // spend quota doing it again.
    return NextResponse.json({
      segments: null,
      source: null,
      canGenerate: !cached,
      estimatedSeconds,
    });
  }

  const fetched = await fetchTranscript(episode.transcriptUrl);
  if (!fetched) {
    return NextResponse.json({
      segments: null,
      source: null,
      canGenerate: !cached,
      estimatedSeconds,
    });
  }

  await db
    .insert(transcripts)
    .values({
      episodeId: id,
      text: fetched.text,
      segments: fetched.segments,
      source: "publisher",
    })
    .onConflictDoUpdate({
      target: transcripts.episodeId,
      // Only fill in timings we don't have. An AI transcript already in the
      // table came out of somebody's quota; don't discard it for a feed one.
      set: { segments: fetched.segments },
    });

  return NextResponse.json({
    segments: fetched.segments,
    source: "publisher",
    publishedDuration,
  });
}
