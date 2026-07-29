import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { listeningHistory, playbackState } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * Playback position sync.
 *
 * Written on a debounce from the client (every ~10s while playing, plus on
 * pause, seek and page hide) rather than continuously — position updates are
 * the highest-frequency write in the app and would otherwise dominate free-tier
 * function invocations.
 */

/** Treat an episode as finished once within this many seconds of the end. */
const SMART_RESUME_TAIL_SECONDS = 15;

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    episodeId?: string;
    positionSeconds?: number;
    durationSeconds?: number | null;
    /** Set explicitly by "mark as played"; otherwise inferred from position. */
    played?: boolean;
    event?: "play_start" | "complete" | "skip";
    podcastId?: string;
    categories?: string[];
  } | null;

  const episodeId = body?.episodeId;
  const position = Number(body?.positionSeconds);

  if (!episodeId || !Number.isFinite(position) || position < 0) {
    return NextResponse.json({ error: "Invalid playback update." }, { status: 400 });
  }

  // Smart resume: finishing an episode should not leave a 3-seconds-remaining
  // progress bar that re-opens at the credits. Anything inside the tail counts
  // as played.
  const duration = body?.durationSeconds ?? null;
  const nearEnd =
    duration != null &&
    Number.isFinite(duration) &&
    duration > 0 &&
    position >= duration - SMART_RESUME_TAIL_SECONDS;

  const played = body?.played ?? nearEnd;
  const now = new Date();

  await db
    .insert(playbackState)
    .values({
      userId: user.id,
      episodeId,
      positionSeconds: position.toFixed(2),
      played,
      lastPlayedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [playbackState.userId, playbackState.episodeId],
      set: {
        positionSeconds: sql`excluded.position_seconds`,
        // Once played, stay played — a stray position write from another device
        // must not silently un-finish an episode.
        played: sql`${playbackState.played} or excluded.played`,
        lastPlayedAt: sql`excluded.last_played_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

  // Recommendation signals are only logged on discrete events, not on every
  // position tick, or the history table would grow without bound.
  if (body?.event) {
    await db.insert(listeningHistory).values({
      userId: user.id,
      episodeId,
      podcastId: body.podcastId ?? null,
      event: body.event,
      categorySnapshot: body.categories ?? [],
    });
  }

  return NextResponse.json({ ok: true, played });
}

/** Bulk-reads positions so an episode list can render progress in one request. */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const ids = request.nextUrl.searchParams.get("episodeIds");
  const episodeIds = ids?.split(",").filter(Boolean) ?? [];

  const rows = await db.query.playbackState.findMany({
    where: eq(playbackState.userId, user.id),
    limit: 500,
  });

  const filtered =
    episodeIds.length > 0
      ? rows.filter((r) => episodeIds.includes(r.episodeId))
      : rows;

  return NextResponse.json({
    playback: filtered.map((r) => ({
      episodeId: r.episodeId,
      positionSeconds: Number(r.positionSeconds),
      played: r.played,
      lastPlayedAt: r.lastPlayedAt,
    })),
  });
}
