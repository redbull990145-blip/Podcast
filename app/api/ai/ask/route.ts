import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { episodes, transcripts } from "@/lib/db/schema";
import { recordUsage, resolveTier, withProviderHint } from "@/lib/ai/quota";
import { answerQuestionStream } from "@/lib/ai/llm";
import { episodePeople, peopleAskedAbout } from "@/lib/ai/people";
import { referenceNotes } from "@/lib/ai/wikipedia";
import { isUuid, sanitizeHistory } from "@/lib/api/validation";
import { stripHtml } from "@/lib/utils";

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

  /**
   * The show's own metadata travels with the transcript, because a listener's
   * questions don't stop at the tape: "who is being interviewed", "what else
   * has this host done", "when did this come out". The feed answers some of
   * those outright, and grounds the rest.
   */
  const episode = await db.query.episodes.findFirst({
    where: eq(episodes.id, episodeId),
    columns: { title: true, description: true, publishedAt: true },
    with: {
      podcast: { columns: { title: true, author: true, description: true } },
    },
  });

  const segments = (transcript.segments ?? []) as {
    start: number;
    end: number;
    text: string;
  }[];

  /**
   * Reference notes, but only for a question about someone this episode is
   * actually about — see people.ts. Costs nothing on every other question, and
   * a failed or slow lookup degrades to the answer we would have given anyway.
   */
  const notes = await referenceNotes(
    peopleAskedAbout(
      question,
      episodePeople(episode?.podcast.author, episode?.title ?? ""),
    ),
  );

  const result = await answerQuestionStream(
    decision.llm,
    {
      episodeTitle: episode?.title ?? "this episode",
      podcastTitle: episode?.podcast.title ?? "this podcast",
      author: episode?.podcast.author,
      // Feed prose is HTML; markup in the prompt is noise the model has to
      // read past.
      showDescription: stripHtml(episode?.podcast.description),
      episodeDescription: stripHtml(episode?.description),
      publishedAt: episode?.publishedAt,
      reference: notes,
    },
    segments,
    transcript.text,
    question,
    history,
  );

  /**
   * Every failure lands here, before a single byte has been sent — the chain
   * commits to a model only once that model's first word arrives. So an error
   * is still an ordinary JSON response with a status the client can read,
   * which is what keeps the quota and "needs a key" messages working.
   */
  if (!result.ok) {
    return NextResponse.json(
      { error: withProviderHint(result.error, decision.tier) },
      { status: 502 },
    );
  }

  /**
   * Charged on who actually answered, not on which tier the request started in.
   * A user with their own key can still land on the operator's chain when their
   * provider is failing, and that call is theirs to account for — while a call
   * their own key served stays free however the request was resolved.
   *
   * Done here rather than at the end of a stream the reader may navigate away
   * from: by this point the call has happened and the answer is being written.
   */
  if (result.metered) await recordUsage(user.id, "qa");

  return new Response(result.stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      // Answers stream as plain text, so anything the client needs to know
      // about the call itself rides on the headers instead.
      "x-ai-tier": decision.tier,
      "x-ai-model": `${result.provider}/${result.model}`,
    },
  });
}
