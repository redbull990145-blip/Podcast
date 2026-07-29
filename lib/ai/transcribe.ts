import type { SttConfig } from "./config";
import type { TranscriptSegment } from "@/lib/db/schema";

/**
 * Speech to text.
 *
 * The audio is streamed from the publisher and forwarded to the provider
 * without ever being written to our storage — we hold it in memory for the
 * duration of one request and discard it.
 */

/**
 * Providers cap upload size (Groq's free tier is 25MB). A typical one-hour
 * episode at 64kbps mono is around 28MB, so longer or higher-bitrate episodes
 * are refused with an explanation rather than a provider error the user
 * can't act on.
 */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 60_000;

export type TranscriptionResult =
  | { ok: true; text: string; segments: TranscriptSegment[]; model: string }
  | { ok: false; error: string };

type VerboseTranscription = {
  text?: string;
  segments?: { start?: number; end?: number; text?: string }[];
};

export async function transcribeAudio(
  audioUrl: string,
  config: SttConfig,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  let audio: Blob;

  try {
    const response = await fetch(audioUrl, { signal });
    if (!response.ok) {
      return { ok: false, error: "Couldn't download the episode audio." };
    }

    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_AUDIO_BYTES) {
      return {
        ok: false,
        error:
          "This episode is too large to transcribe (over 25MB). Very long episodes aren't supported yet.",
      };
    }

    audio = await response.blob();
    if (audio.size > MAX_AUDIO_BYTES) {
      return {
        ok: false,
        error:
          "This episode is too large to transcribe (over 25MB). Very long episodes aren't supported yet.",
      };
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Transcription timed out." };
    }
    return { ok: false, error: "Couldn't download the episode audio." };
  }

  const form = new FormData();
  form.append("file", audio, "episode.mp3");
  form.append("model", config.model);
  // Verbose JSON returns per-segment timings, which is what makes a citation
  // clickable — without them an answer can only quote, not seek.
  form.append("response_format", "verbose_json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: signal ?? controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 429) {
        return {
          ok: false,
          error: "The transcription service is rate limited right now. Try again shortly.",
        };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: "The transcription API key was rejected." };
      }
      // Never surface the raw provider body to the client — it can echo the key.
      console.error("Transcription failed", response.status, detail.slice(0, 200));
      return { ok: false, error: "Transcription failed. Please try again." };
    }

    const data = (await response.json()) as VerboseTranscription;
    const text = data.text?.trim() ?? "";
    if (!text) {
      return { ok: false, error: "The transcription came back empty." };
    }

    const segments: TranscriptSegment[] = (data.segments ?? [])
      .filter((s) => typeof s.text === "string")
      .map((s) => ({
        start: Number(s.start ?? 0),
        end: Number(s.end ?? 0),
        text: (s.text ?? "").trim(),
      }))
      .filter((s) => s.text.length > 0);

    return { ok: true, text, segments, model: `${config.provider}/${config.model}` };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Transcription timed out." };
    }
    return { ok: false, error: "Couldn't reach the transcription service." };
  } finally {
    clearTimeout(timeout);
  }
}
