import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { aiJobs, episodes, summaries, transcripts } from "@/lib/db/schema";
import { recordUsage, resolveTier } from "@/lib/ai/quota";
import { transcribeAudio } from "@/lib/ai/transcribe";
import { generateChapters, generateShowNotes } from "@/lib/ai/llm";

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
  } | null;

  const episodeId = body?.episodeId;
  const kind: GenerateKind =
    body?.kind && KINDS.includes(body.kind) ? body.kind : "show_notes";

  if (!episodeId) {
    return NextResponse.json({ error: "An episode id is required." }, { status: 400 });
  }

  const episode = await db.query.episodes.findFirst({
    where: eq(episodes.id, episodeId),
    with: { podcast: { columns: { title: true } } },
  });
  if (!episode) {
    return NextResponse.json({ error: "Unknown episode." }, { status: 404 });
  }

  // Serve from cache before spending anything.
  const cached = await readCached(episodeId, kind);
  if (cached) return NextResponse.json({ ...cached, cached: true });

  const decision = await resolveTier(user.id, "jobs");
  if (!decision.allowed) {
    return NextResponse.json(
      { error: decision.reason, quotaExhausted: true, used: decision.used, limit: decision.limit },
      { status: 429 },
    );
  }

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
      tier: decision.tier,
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

  if (!transcript) {
    if (!decision.stt) {
      return fail(
        "Transcription isn't configured on this server. Add an OpenAI or Groq key in Settings to transcribe episodes yourself.",
        503,
      );
    }

    const result = await transcribeAudio(episode.enclosureUrl, decision.stt);
    if (!result.ok) return fail(result.error);

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
    if (decision.tier === "default") await recordUsage(user.id, "jobs");
    return NextResponse.json({ segments, source: transcript.source });
  }

  await db
    .update(aiJobs)
    .set({ status: "summarizing", updatedAt: new Date() })
    .where(eq(aiJobs.id, job.id));

  // --- generation ---------------------------------------------------------

  if (kind === "chapters") {
    const result = await generateChapters(decision.llm, episode.title, segments);
    if (!result.ok) return fail(result.error);

    await db
      .update(episodes)
      .set({ chapters: result.chapters, chaptersSource: "ai_generated" })
      .where(eq(episodes.id, episodeId));

    await finish(job.id);
    if (decision.tier === "default") await recordUsage(user.id, "jobs");

    return NextResponse.json({ chapters: result.chapters, source: "ai_generated" });
  }

  const result = await generateShowNotes(
    decision.llm,
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
      model: `${decision.llm.provider}/${decision.llm.model}`,
    })
    .onConflictDoUpdate({
      target: [summaries.episodeId, summaries.kind],
      set: { text: result.text, model: `${decision.llm.provider}/${decision.llm.model}` },
    });

  await finish(job.id);
  if (decision.tier === "default") await recordUsage(user.id, "jobs");

  return NextResponse.json({
    text: result.text,
    model: `${decision.llm.provider}/${decision.llm.model}`,
    tier: decision.tier,
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
