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
  choices?: {
    message?: { content?: string; reasoning?: string };
    finish_reason?: string;
  }[];
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
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; error: string; status?: number }
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
    const choice = data.choices?.[0];
    const text = choice?.message?.content?.trim();

    /**
     * Reasoning models spend tokens thinking before they answer, and some
     * report that thinking separately rather than in `content`. An empty
     * `content` next to a non-empty `reasoning` means the budget ran out
     * mid-thought — the answer was never reached.
     */
    if (!text) {
      const thought = choice?.message?.reasoning?.trim();
      if (thought) {
        console.error(
          "LLM returned only reasoning, no answer",
          model,
          thought.slice(0, 200),
        );
        return { ok: false, error: "The AI ran out of room before answering." };
      }
      return { ok: false, error: "The AI service returned nothing." };
    }

    return { ok: true, text, truncated: choice?.finish_reason === "length" };
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
 *
 * `parse` extends that same logic past the HTTP layer. A model can answer 200
 * OK and still be useless to the caller — a reasoning model that thinks until
 * it runs out of room, or one that ignores "JSON only" and writes an essay.
 * That is a property of the model, not the request, so it is exactly as
 * retryable as a 429 and is treated the same way. Callers that only need prose
 * omit it and take the first successful response.
 */
async function chat<T = string>(
  config: LlmConfig,
  messages: ChatMessage[],
  options: {
    maxTokens?: number;
    temperature?: number;
    parse?: (text: string) => T | null;
  } = {},
): Promise<{ ok: true; text: string; value: T } | { ok: false; error: string }> {
  const candidates = config.models.length > 0 ? config.models : [config.model];
  let last: { ok: false; error: string; status?: number } | null = null;

  for (const model of candidates) {
    const result = await chatOnce(config, model, messages, options);

    if (result.ok) {
      if (!options.parse) {
        return { ok: true, text: result.text, value: result.text as T };
      }

      const value = options.parse(result.text);
      if (value !== null) return { ok: true, text: result.text, value };

      // Unusable answer. Log what it actually said — without this the only
      // symptom is a generic failure with no way to tell which model misbehaved.
      console.error(
        "LLM answer could not be used, trying next model",
        model,
        result.truncated ? "(truncated: ran out of tokens)" : "",
        result.text.slice(0, 300),
      );
      last = { ok: false, error: "The AI returned something we couldn't read." };
      continue;
    }

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

  const duration = segments[segments.length - 1]?.end ?? Infinity;

  const result = await chat<Chapter[]>(
    config,
    [
      {
        role: "system",
        content:
          "You segment podcast transcripts into chapters. Reply with a JSON array and nothing else — no reasoning, no explanation, no code fences. Begin your reply with the character [.",
      },
      {
        role: "user",
        content: `Split "${episodeTitle}" into 5-12 chapters based on where the topic actually changes.

Respond with a JSON array only, in this exact shape:
[{"startTime": 0, "title": "Introduction"}, {"startTime": 312, "title": "…"}]

startTime is in seconds and must be one of the timestamps shown in the transcript. Titles should be 2-6 words describing what is discussed. The first chapter must start at 0.

Do not explain your reasoning. Output the array immediately.

Transcript:
${truncate(withTimestamps(segments))}`,
      },
    ],
    {
      /*
       * Sized for a reasoning model, not for the answer.
       *
       * Twelve chapters of JSON is perhaps 300 tokens, and the previous budget
       * of 900 looked generous against that. But models in the free chain think
       * before they answer and their thinking is billed to the same budget, so
       * the whole allowance went on deliberation and the response was cut off
       * mid-sentence, before a single bracket was emitted. The ceiling has to
       * cover the thinking as well as the answer.
       */
      maxTokens: 4000,
      temperature: 0.2,
      parse: (text) => parseChapters(text, duration),
    },
  );

  if (!result.ok) {
    return { ok: false, error: "The AI couldn't produce chapters for this episode. Try again." };
  }

  return { ok: true, chapters: result.value };
}

/**
 * Turns a model's reply into chapters, or null if nothing usable is in it.
 *
 * Null is a signal to try another model rather than an error to show anyone,
 * so every rejection here is a judgement that *this* response is unusable —
 * not that the episode can't be chaptered.
 */
function parseChapters(text: string, duration: number): Chapter[] | null {
  const parsed = extractChapterArray(text);
  if (!parsed) return null;

  const chapters = parsed
    .map((c): Chapter | null => {
      if (!c || typeof c !== "object") return null;
      const obj = c as Record<string, unknown>;
      const startTime = coerceStartTime(obj);
      const title = coerceTitle(obj);
      // Drop anything past the end of the episode — a hallucinated timestamp
      // would produce a chapter that seeks nowhere.
      if (startTime == null || startTime < 0 || startTime > duration) return null;
      if (!title) return null;
      return { startTime, title };
    })
    .filter((c): c is Chapter => c !== null)
    .sort((a, b) => a.startTime - b.startTime);

  // One chapter is not a chaptering — it's the episode. Two is the point at
  // which the strip can actually navigate somewhere.
  return chapters.length >= 2 ? chapters : null;
}

/**
 * Fishes the chapter array out of whatever the model actually returned.
 *
 * Free-tier models are inconsistent: they wrap output in code fences, add a
 * preamble, return `{"chapters": [...]}`, or emit trailing commentary. This
 * tries the cheapest interpretation first and widens outward, rather than
 * relying on one greedy regex that breaks the moment prose contains brackets.
 */
function extractChapterArray(text: string): unknown[] | null {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const asArray = (value: unknown): unknown[] | null => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      // Common wrappers: {"chapters": [...]}, {"data": [...]}, etc.
      for (const key of ["chapters", "data", "items", "result"]) {
        const inner = (value as Record<string, unknown>)[key];
        if (Array.isArray(inner)) return inner;
      }
    }
    return null;
  };

  try {
    const arr = asArray(JSON.parse(stripped));
    if (arr) return arr;
  } catch {
    // Fall through to bracket scanning.
  }

  // Scan for the first balanced [...] block. Skips brackets inside strings so
  // an embedded timestamp like "[0:00]" in a title doesn't fool the counter.
  const start = stripped.indexOf("[");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const arr = asArray(JSON.parse(stripped.slice(start, i + 1)));
          if (arr) return arr;
        } catch {
          return null;
        }
        return null;
      }
    }
  }
  return null;
}

function coerceStartTime(obj: Record<string, unknown>): number | null {
  const raw = obj.startTime ?? obj.start_time ?? obj.start ?? obj.time ?? obj.timestamp;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    // "mm:ss" or "hh:mm:ss"
    const parts = trimmed.split(":").map((p) => Number(p));
    if (parts.length > 1 && parts.every((p) => Number.isFinite(p))) {
      return parts.reduce((acc, p) => acc * 60 + p, 0);
    }
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function coerceTitle(obj: Record<string, unknown>): string {
  const raw = obj.title ?? obj.name ?? obj.chapter ?? obj.heading;
  return typeof raw === "string" ? raw.trim() : "";
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
