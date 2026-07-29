import type { LlmConfig } from "./config";
import type { Chapter, TranscriptSegment } from "@/lib/db/schema";

/**
 * LLM calls over a transcript.
 *
 * There is no vector database and no retrieval step. An hour of speech is
 * roughly 12-16k tokens, which fits comfortably in any current model's context
 * window, so the whole transcript goes in the prompt. That removes an entire
 * class of infrastructure (embeddings, a vector store, chunk-boundary bugs) in
 * exchange for slightly more tokens per call.
 */

const REQUEST_TIMEOUT_MS = 55_000;

/**
 * Guard against a pathological transcript blowing the context window. Roughly
 * four characters per token, so this is about 100k tokens.
 */
const MAX_TRANSCRIPT_CHARS = 400_000;

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
};

/** Errors worth retrying against the next model in the fallback chain. */
function isRetryableAcrossModels(status: number): boolean {
  // 429: this specific free model's own rate limit is exhausted.
  // 404: the model id is wrong or was removed from the free catalogue.
  // 400: some providers report an unrecognized model id as a bad request.
  return status === 429 || status === 404 || status === 400;
}

async function chatOnce(
  config: LlmConfig,
  model: string,
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number },
): Promise<
  { ok: true; text: string } | { ok: false; error: string; status?: number }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        // OpenRouter asks callers to identify themselves; harmless elsewhere.
        "http-referer": "https://github.com/redbull990145-blip/Podcast",
        "x-title": "Cadence",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? 1500,
        temperature: options.temperature ?? 0.3,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // The provider's error body can echo request headers, so it is logged
      // server-side and never returned to the client.
      console.error(
        "LLM call failed",
        model,
        response.status,
        detail.slice(0, 200),
      );

      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: "The AI API key was rejected.", status: response.status };
      }
      return {
        ok: false,
        error: "The AI service returned an error.",
        status: response.status,
      };
    }

    const data = (await response.json()) as ChatResponse;
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, error: "The AI service returned nothing." };

    return { ok: true, text };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "The AI service took too long to respond." };
    }
    return { ok: false, error: "Couldn't reach the AI service." };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Tries each model in the config's fallback chain in order.
 *
 * OpenRouter's free-variant models each have their own separate rate limit, so
 * one being exhausted does not mean the free tier is exhausted — it means the
 * next model in the list probably works. An API-key rejection is not
 * model-specific and stops the chain immediately rather than burning through
 * every candidate for the same reason.
 */
async function chat(
  config: LlmConfig,
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const candidates = config.models.length > 0 ? config.models : [config.model];
  let last: { ok: false; error: string; status?: number } | null = null;

  for (const model of candidates) {
    const result = await chatOnce(config, model, messages, options);
    if (result.ok) return result;

    last = result;
    if (result.status === 401 || result.status === 403) break;
    if (result.status != null && !isRetryableAcrossModels(result.status)) break;
  }

  return { ok: false, error: last?.error ?? "The AI service returned an error." };
}

function truncate(transcript: string): string {
  return transcript.length > MAX_TRANSCRIPT_CHARS
    ? `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[transcript truncated]`
    : transcript;
}

/** Renders segments as "[mm:ss] text" so the model can cite real timestamps. */
function withTimestamps(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => {
      const minutes = Math.floor(s.start / 60);
      const seconds = Math.floor(s.start % 60);
      return `[${minutes}:${String(seconds).padStart(2, "0")}] ${s.text}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Show notes
// ---------------------------------------------------------------------------

export async function generateShowNotes(
  config: LlmConfig,
  episodeTitle: string,
  podcastTitle: string,
  transcript: string,
) {
  return chat(
    config,
    [
      {
        role: "system",
        content:
          "You write concise, accurate show notes for podcast episodes. Use only what is in the transcript — never invent names, figures, or claims that aren't there. Write in plain prose, not marketing copy.",
      },
      {
        role: "user",
        content: `Episode: "${episodeTitle}" from the podcast "${podcastTitle}".

Write show notes with exactly these sections, using markdown headings:

## Summary
Two or three sentences on what this episode covers.

## Key takeaways
Four to six bullet points, each a specific claim or idea from the episode.

## Topics discussed
A short comma-separated list.

Transcript:
${truncate(transcript)}`,
      },
    ],
    { maxTokens: 1200 },
  );
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

export async function generateChapters(
  config: LlmConfig,
  episodeTitle: string,
  segments: TranscriptSegment[],
): Promise<{ ok: true; chapters: Chapter[] } | { ok: false; error: string }> {
  if (segments.length === 0) {
    return { ok: false, error: "No timed transcript available for this episode." };
  }

  const result = await chat(
    config,
    [
      {
        role: "system",
        content:
          "You segment podcast transcripts into chapters. Respond with JSON only — no prose, no code fences.",
      },
      {
        role: "user",
        content: `Split "${episodeTitle}" into 5-12 chapters based on where the topic actually changes.

Respond with a JSON array only, in this exact shape:
[{"startTime": 0, "title": "Introduction"}, {"startTime": 312, "title": "…"}]

startTime is in seconds and must be one of the timestamps shown in the transcript. Titles should be 2-6 words describing what is discussed. The first chapter must start at 0.

Transcript:
${truncate(withTimestamps(segments))}`,
      },
    ],
    { maxTokens: 900, temperature: 0.2 },
  );

  if (!result.ok) return result;

  // Models sometimes wrap JSON in prose or code fences despite instructions.
  const match = result.text.match(/\[[\s\S]*\]/);
  if (!match) {
    return { ok: false, error: "Couldn't read the generated chapters." };
  }

  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) throw new Error("not an array");

    const duration = segments[segments.length - 1]?.end ?? Infinity;

    const chapters = parsed
      .map((c): Chapter | null => {
        if (!c || typeof c !== "object") return null;
        const obj = c as Record<string, unknown>;
        const startTime = Number(obj.startTime);
        const title = typeof obj.title === "string" ? obj.title.trim() : "";
        // Drop anything past the end of the episode — a hallucinated timestamp
        // would produce a chapter that seeks nowhere.
        if (!Number.isFinite(startTime) || startTime < 0 || startTime > duration) {
          return null;
        }
        if (!title) return null;
        return { startTime, title };
      })
      .filter((c): c is Chapter => c !== null)
      .sort((a, b) => a.startTime - b.startTime);

    if (chapters.length === 0) {
      return { ok: false, error: "Couldn't read the generated chapters." };
    }

    return { ok: true, chapters };
  } catch {
    return { ok: false, error: "Couldn't read the generated chapters." };
  }
}

// ---------------------------------------------------------------------------
// Episode Q&A
// ---------------------------------------------------------------------------

export async function answerQuestion(
  config: LlmConfig,
  episodeTitle: string,
  segments: TranscriptSegment[],
  transcript: string,
  question: string,
  history: ChatMessage[] = [],
) {
  // Timed segments let the model cite a seekable position. Without them it can
  // still answer, just without citations.
  const body = segments.length > 0 ? withTimestamps(segments) : transcript;

  return chat(
    config,
    [
      {
        role: "system",
        content: `You answer questions about a specific podcast episode using only its transcript.

Rules:
- If the transcript doesn't contain the answer, say so plainly. Never guess.
- Cite the moment each claim comes from using the format [mm:ss] inline, taken from the timestamps in the transcript.
- Be direct and brief. No preamble, no restating the question.`,
      },
      ...history.slice(-6),
      {
        role: "user",
        content: `Episode: "${episodeTitle}"

Transcript:
${truncate(body)}

Question: ${question}`,
      },
    ],
    { maxTokens: 800 },
  );
}
