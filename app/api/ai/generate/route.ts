import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { aiJobs, episodes, summaries, transcripts } from "@/lib/db/schema";
import { recordUsage, resolveTier } from "@/lib/ai/quota";
import { colabSttConfig } from "@/lib/ai/config";
import { servedLocally, transcribeWithFallback } from "@/lib/ai/transcribe";
import { generateChapters, generateShowNotes } from "@/lib/ai/llm";
import { isUuid } from "@/lib/api/validation";

export const runtime = "nodejs";

/**
 * Vercel allows up to 60s per function on the plans this targets. Transcription
 * on an LPU-backed provider is well inside that for a typical episode, and the
 * audio download dominates. If a long episode does time out, the job is left in
 * an error state the user can retry — no partial writes, because the transcript
 * is only persisted once it is complete.
 */
export const maxDuration = 60;

type GenerateKind = "show_notes" | "chapters" | "transcript";

const KINDS: GenerateKind[] = ["show_notes", "chapters", "transcript"];

/**
 * Produces AI show notes or chapters for an episode.
 *
 * Transcripts and summaries are cached per episode rather than per user: the
 * first person to generate one pays for it (in quota or their own key), and
 * everyone after gets it free without touching their allowance. That is the
 * single biggest cost saving in the whole feature.
 */
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    episodeId?: string;
    kind?: GenerateKind;
    force?: boolean;
  } | null;

  const episodeId = body?.episodeId;
  const kind: GenerateKind =
    body?.kind && KINDS.includes(body.kind) ? body.kind : "show_notes";

  /**
   * Transcribe again even though there is already a transcript.
   *
   * The cache is what makes this feature affordable, so this is deliberately
   * narrow: transcripts only, and only when asked for outright. It exists
   * because a cached transcript can be *wrong* — a provider that returned
   * timings on the wrong clock, or a model that locked into a repetition loop
   * — and until this there was no way to get past one. The listener who can
   * hear that the captions don't match is the only one in a position to say so.
   */
  const force = body?.force === true && kind === "transcript";

  if (!episodeId) {
    return NextResponse.json({ error: "An episode id is required." }, { status: 400 });
  }
  if (!isUuid(episodeId)) {
    return NextResponse.json({ error: "Unknown episode." }, { status: 400 });
  }

  const episode = await db.query.episodes.findFirst({
    where: eq(episodes.id, episodeId),
    with: { podcast: { columns: { title: true } } },
  });
  if (!episode) {
    return NextResponse.json({ error: "Unknown episode." }, { status: 404 });
  }

  // Serve from cache before spending anything.
  const cached = force ? null : await readCached(episodeId, kind);
  if (cached) return NextResponse.json({ ...cached, cached: true });

  const decision = await resolveTier(user.id, "jobs");

  /**
   * The daily quota exists to cap what the *operator* spends, so work that
   * costs the operator nothing has no business being metered by it.
   *
   * A developer running their own Whisper server (see colab/README.md) can
   * therefore still generate captions past the limit — but only captions:
   * show notes and chapters additionally need an operator-funded LLM call,
   * which the allowance does have to cover however the transcript was made.
   */
  const hasLocalStt = colabSttConfig() !== null;
  const localOnly = !decision.allowed && kind === "transcript" && hasLocalStt;

  if (!decision.allowed && !localOnly) {
    return NextResponse.json(
      { error: decision.reason, quotaExhausted: true, used: decision.used, limit: decision.limit },
      { status: 429 },
    );
  }

  // Non-null exactly when the request is running on quota rather than purely
  // on local compute. Anything operator-funded below has to go through this.
  const funded = decision.allowed ? decision : null;

  const [job] = await db
    .insert(aiJobs)
    .values({
      userId: user.id,
      episodeId,
      kind:
        kind === "chapters"
          ? "generate_chapters"
          : kind === "transcript"
            ? "transcribe"
            : "summarize",
      status: "transcribing",
      tier: funded?.tier ?? "local",
    })
    .returning();

  async function fail(message: string, status = 502) {
    await db
      .update(aiJobs)
      .set({ status: "error", errorMessage: message, updatedAt: new Date() })
      .where(eq(aiJobs.id, job.id));
    return NextResponse.json({ error: message, jobId: job.id }, { status });
  }

  // --- transcript (cached across all users) ------------------------------
  let transcript = await db.query.transcripts.findFirst({
    where: eq(transcripts.episodeId, episodeId),
  });

  // Tracks who actually did the work, so a transcript produced on the
  // developer's own hardware doesn't burn anyone's allowance below.
  let transcribedLocally = false;

  if (!transcript || force) {
    // Null when the quota is spent: local-only, because falling back to a
    // paid provider is precisely what an exhausted allowance rules out.
    const fallbackStt = funded?.stt ?? null;

    if (!fallbackStt && !hasLocalStt) {
      return fail(
        "Transcription isn't configured on this server. Add an OpenAI or Groq key in Settings to transcribe episodes yourself.",
        503,
      );
    }

    const result = await transcribeWithFallback(episode.enclosureUrl, fallbackStt);
    if (!result.ok) return fail(result.error);
    transcribedLocally = servedLocally(result);

    const [row] = await db
      .insert(transcripts)
      .values({
        episodeId,
        text: result.text,
        segments: result.segments,
        source: result.model,
        generatedByUserId: user.id,
      })
      .onConflictDoUpdate({
        // Two people can request the same episode at once; last write wins and
        // both get a usable transcript.
        target: transcripts.episodeId,
        set: { text: result.text, segments: result.segments, source: result.model },
      })
      .returning();
    transcript = row;
  }

  const segments = (transcript.segments ?? []) as {
    start: number;
    end: number;
    text: string;
  }[];

  // Captions only need the transcript, so stop here rather than making an LLM
  // call the caller never asked for.
  if (kind === "transcript") {
    await finish(job.id);
    // Charged only when an operator-funded provider actually did the work.
    if (funded?.tier === "default" && !transcribedLocally) {
      await recordUsage(user.id, "jobs");
    }
    return NextResponse.json({ segments, source: transcript.source });
  }

  // Everything past here makes an operator-funded LLM call. Unreachable
  // without quota — only transcript jobs can get this far on local compute —
  // but stated rather than assumed.
  if (!funded) {
    return fail(
      "Generating show notes and chapters still needs your daily AI allowance, which is used up for today.",
      429,
    );
  }

  await db
    .update(aiJobs)
    .set({ status: "summarizing", updatedAt: new Date() })
    .where(eq(aiJobs.id, job.id));

  // --- generation ---------------------------------------------------------

  if (kind === "chapters") {
    const result = await generateChapters(funded.llm, episode.title, segments);
    if (!result.ok) return fail(result.error);

    await db
      .update(episodes)
      .set({ chapters: result.chapters, chaptersSource: "ai_generated" })
      .where(eq(episodes.id, episodeId));

    await finish(job.id);
    if (funded.tier === "default") await recordUsage(user.id, "jobs");

    return NextResponse.json({ chapters: result.chapters, source: "ai_generated" });
  }

  const result = await generateShowNotes(
    funded.llm,
    episode.title,
    episode.podcast.title,
    transcript.text,
  );
  if (!result.ok) return fail(result.error);

  await db
    .insert(summaries)
    .values({
      episodeId,
      kind: "show_notes",
      text: result.text,
      model: `${funded.llm.provider}/${funded.llm.model}`,
    })
    .onConflictDoUpdate({
      target: [summaries.episodeId, summaries.kind],
      set: { text: result.text, model: `${funded.llm.provider}/${funded.llm.model}` },
    });

  await finish(job.id);
  if (funded.tier === "default") await recordUsage(user.id, "jobs");

  return NextResponse.json({
    text: result.text,
    model: `${funded.llm.provider}/${funded.llm.model}`,
    tier: funded.tier,
  });
}

async function finish(jobId: string) {
  await db
    .update(aiJobs)
    .set({ status: "done", updatedAt: new Date() })
    .where(eq(aiJobs.id, jobId));
}

async function readCached(episodeId: string, kind: GenerateKind) {
  if (kind === "transcript") {
    const row = await db.query.transcripts.findFirst({
      where: eq(transcripts.episodeId, episodeId),
      columns: { segments: true, source: true },
    });
    return row?.segments ? { segments: row.segments, source: row.source } : null;
  }

  if (kind === "chapters") {
    const episode = await db.query.episodes.findFirst({
      where: eq(episodes.id, episodeId),
      columns: { chapters: true, chaptersSource: true },
    });
    return episode?.chapters
      ? { chapters: episode.chapters, source: episode.chaptersSource }
      : null;
  }

  const summary = await db.query.summaries.findFirst({
    where: (s, { and }) =>
      and(eq(s.episodeId, episodeId), eq(s.kind, "show_notes")),
  });
  return summary ? { text: summary.text, model: summary.model } : null;
}

/** Returns whatever is already cached, so the UI can render without generating. */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const episodeId = request.nextUrl.searchParams.get("episodeId");
  if (!episodeId) {
    return NextResponse.json({ error: "An episode id is required." }, { status: 400 });
  }
  if (!isUuid(episodeId)) {
    return NextResponse.json({ error: "Unknown episode." }, { status: 400 });
  }

  const summary = await readCached(episodeId, "show_notes");
  const transcript = await db.query.transcripts.findFirst({
    where: eq(transcripts.episodeId, episodeId),
    columns: { episodeId: true },
  });

  return NextResponse.json({
    showNotes: summary,
    hasTranscript: Boolean(transcript),
  });
}
