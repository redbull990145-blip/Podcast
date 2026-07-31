import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { episodes, transcripts } from "@/lib/db/schema";
import { recordUsage, resolveTier } from "@/lib/ai/quota";
import { answerQuestion } from "@/lib/ai/llm";
import { isUuid, sanitizeHistory } from "@/lib/api/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Answers a question about one episode.
 *
 * Counts against the cheaper "qa" allowance rather than the generation
 * allowance, since it reuses an existing transcript and is a single short LLM
 * call. Requires a transcript to already exist — asking a question does not
 * silently trigger an expensive transcription.
 */
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    episodeId?: string;
    question?: string;
    history?: { role: "user" | "assistant"; content: string }[];
  } | null;

  const episodeId = body?.episodeId;
  const question = body?.question?.trim();

  if (!episodeId || !question) {
    return NextResponse.json(
      { error: "An episode id and a question are required." },
      { status: 400 },
    );
  }
  if (!isUuid(episodeId)) {
    return NextResponse.json({ error: "Unknown episode." }, { status: 400 });
  }
  if (question.length > 1000) {
    return NextResponse.json({ error: "That question is too long." }, { status: 400 });
  }

  // Roles re-derived and lengths capped — see sanitizeHistory.
  const history = sanitizeHistory(body?.history);

  const transcript = await db.query.transcripts.findFirst({
    where: eq(transcripts.episodeId, episodeId),
  });

  if (!transcript) {
    return NextResponse.json(
      {
        error:
          "This episode hasn't been transcribed yet. Generate show notes first, then you can ask about it.",
        needsTranscript: true,
      },
      { status: 409 },
    );
  }

  const decision = await resolveTier(user.id, "qa");
  if (!decision.allowed) {
    return NextResponse.json(
      {
        error: decision.reason,
        quotaExhausted: true,
        used: decision.used,
        limit: decision.limit,
      },
      { status: 429 },
    );
  }

  const episode = await db.query.episodes.findFirst({
    where: eq(episodes.id, episodeId),
    columns: { title: true },
  });

  const segments = (transcript.segments ?? []) as {
    start: number;
    end: number;
    text: string;
  }[];

  const result = await answerQuestion(
    decision.llm,
    episode?.title ?? "this episode",
    segments,
    transcript.text,
    question,
    history,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  if (decision.tier === "default") await recordUsage(user.id, "qa");

  return NextResponse.json({ answer: result.text, tier: decision.tier });
}
