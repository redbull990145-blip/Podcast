import type { SttConfig } from "./config";
import type { TranscriptSegment } from "@/lib/db/schema";

/**
 * Speech to text.
 *
 * The audio is streamed from the publisher and forwarded to the provider
 * without ever being written to our storage — we hold it in memory for the
 * duration of one request and discard it.
 *
 * Providers cap the size of a single upload (Groq's free Whisper tier is 25MB),
 * which a typical hour-long episode already exceeds. Rather than refuse those,
 * anything over the cap is fetched in byte ranges, each range is transcribed on
 * its own, and the per-chunk timings are shifted back onto a single timeline so
 * captions still line up with the audio.
 */

/** Hard per-request ceiling the provider enforces. Groq free tier is 25MB. */
const PROVIDER_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Target size of each chunk when splitting. Kept under the provider cap with
 * headroom for the multipart envelope, which adds a few hundred bytes.
 */
const CHUNK_TARGET_BYTES = 20 * 1024 * 1024;

/**
 * Refuse truly enormous files. At roughly 1MB/minute (128kbps) this is about a
 * six-hour episode — past which the sequential download alone would blow the
 * function's time budget, so failing fast with a clear message beats timing out.
 */
const MAX_TOTAL_BYTES = 360 * 1024 * 1024;

/** How many chunks transcribe at once. Bounded to respect free-tier rate limits. */
const TRANSCRIBE_CONCURRENCY = 3;

/**
 * Fallback calibration when neither a feed duration nor a usable first chunk is
 * available: assume a 128kbps CBR stream (16000 bytes/sec). Only used to place
 * chunk boundaries on the timeline, and only when everything better is missing.
 */
const NOMINAL_BYTES_PER_SEC = 16_000;

const PROBE_TIMEOUT_MS = 20_000;
const CHUNK_FETCH_TIMEOUT_MS = 45_000;
const TRANSCRIBE_TIMEOUT_MS = 60_000;

export type TranscriptionResult =
  | { ok: true; text: string; segments: TranscriptSegment[]; model: string }
  | { ok: false; error: string };

type TranscribeOptions = {
  /** Feed-reported episode length, used to place chunk boundaries accurately. */
  durationSeconds?: number | null;
  signal?: AbortSignal;
};

type VerboseTranscription = {
  text?: string;
  segments?: { start?: number; end?: number; text?: string }[];
};

type ChunkResult = { startByte: number; byteLength: number; segments: TranscriptSegment[] };

const TOO_LONG_ERROR =
  "This episode is too long to transcribe automatically yet. Try an episode under about six hours.";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Splits a byte length into [start, endExclusive) ranges of at most `chunkSize`. */
export function planChunks(
  total: number,
  chunkSize = CHUNK_TARGET_BYTES,
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (let start = 0; start < total; start += chunkSize) {
    ranges.push({ start, end: Math.min(start + chunkSize, total) });
  }
  return ranges;
}

/**
 * Seconds-per-byte used to translate a chunk's byte offset into its start time
 * on the global timeline.
 *
 * MP3 podcast files are effectively constant-bitrate, so time is proportional
 * to byte position. A trustworthy feed duration gives the exact rate for the
 * whole file; failing that, the first chunk's measured duration calibrates it;
 * failing even that, a nominal bitrate keeps things roughly aligned.
 */
export function calibrateSecondsPerByte(input: {
  total: number;
  durationSeconds?: number | null;
  firstChunkBytes?: number;
  firstChunkDuration?: number;
}): number {
  const { total, durationSeconds, firstChunkBytes, firstChunkDuration } = input;

  if (durationSeconds && durationSeconds > 0 && total > 0) {
    return durationSeconds / total;
  }
  if (firstChunkBytes && firstChunkBytes > 0 && firstChunkDuration && firstChunkDuration > 0) {
    return firstChunkDuration / firstChunkBytes;
  }
  return 1 / NOMINAL_BYTES_PER_SEC;
}

/**
 * Shifts every chunk's segments onto one timeline and merges them.
 *
 * Within a chunk Whisper's timings are accurate and start from zero; only the
 * chunk's own start time is unknown, and that comes from its byte offset. After
 * offsetting, segments are ordered and the odd duplicate that a frame of overlap
 * at a cut point can produce is dropped.
 */
export function mergeSegments(
  chunks: ChunkResult[],
  secondsPerByte: number,
): TranscriptSegment[] {
  const all: TranscriptSegment[] = [];

  for (const chunk of chunks) {
    const offset = chunk.startByte * secondsPerByte;
    for (const seg of chunk.segments) {
      const text = seg.text.trim();
      if (!text) continue;
      all.push({ start: seg.start + offset, end: seg.end + offset, text });
    }
  }

  all.sort((a, b) => a.start - b.start);

  const merged: TranscriptSegment[] = [];
  for (const seg of all) {
    const prev = merged[merged.length - 1];
    // A cut can make the same line appear at the tail of one chunk and the head
    // of the next; skip a near-identical repeat rather than show it twice.
    if (prev && prev.text === seg.text && Math.abs(prev.start - seg.start) < 1.5) {
      continue;
    }
    merged.push(seg);
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/** Discovers the total size and whether the host honours range requests. */
async function probeAudio(
  url: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; total: number; rangeSupported: boolean }
  | { ok: false; error: string }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const combined = mergeSignals(signal, controller.signal);

  try {
    // A single-byte range doubles as a cheap capability probe: a 206 with a
    // Content-Range header means the host supports the ranged fetches chunking
    // needs, and hands us the total size in the process.
    const response = await fetch(url, {
      headers: { range: "bytes=0-0" },
      signal: combined,
    });

    if (response.status === 206) {
      const match = /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "");
      // Drain the one-byte body so the socket can be reused.
      await response.arrayBuffer().catch(() => undefined);
      const total = match ? Number(match[1]) : 0;
      if (total > 0) return { ok: true, total, rangeSupported: true };
      return { ok: true, total: 0, rangeSupported: false };
    }

    if (response.ok) {
      const total = Number(response.headers.get("content-length") ?? 0);
      await response.body?.cancel().catch(() => undefined);
      return { ok: true, total, rangeSupported: false };
    }

    return { ok: false, error: "Couldn't download the episode audio." };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Transcription timed out while reading the audio." };
    }
    return { ok: false, error: "Couldn't download the episode audio." };
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetches one byte range as a Blob. */
async function fetchRange(
  url: string,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<Blob> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHUNK_FETCH_TIMEOUT_MS);
  const combined = mergeSignals(signal, controller.signal);

  try {
    const response = await fetch(url, {
      // end is inclusive in an HTTP range header.
      headers: { range: `bytes=${start}-${end - 1}` },
      signal: combined,
    });
    if (!response.ok) throw new Error(`range fetch failed: ${response.status}`);
    return await response.blob();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sends one audio blob to the provider and returns its (chunk-relative) segments.
 *
 * The error is a discriminated result rather than a throw so the orchestrator
 * can tell a retryable rate-limit apart from a rejected key.
 */
async function transcribeBlob(
  audio: Blob,
  config: SttConfig,
  signal?: AbortSignal,
): Promise<
  | { ok: true; text: string; segments: TranscriptSegment[] }
  | { ok: false; error: string }
> {
  const form = new FormData();
  form.append("file", audio, "episode.mp3");
  form.append("model", config.model);
  // Verbose JSON returns per-segment timings, which is what makes a citation
  // clickable — without them an answer can only quote, not seek.
  form.append("response_format", "verbose_json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
  const combined = mergeSignals(signal, controller.signal);

  try {
    const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: combined,
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

    const segments: TranscriptSegment[] = (data.segments ?? [])
      .filter((s) => typeof s.text === "string")
      .map((s) => ({
        start: Number(s.start ?? 0),
        end: Number(s.end ?? 0),
        text: (s.text ?? "").trim(),
      }))
      .filter((s) => s.text.length > 0);

    return { ok: true, text, segments };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Transcription timed out." };
    }
    return { ok: false, error: "Couldn't reach the transcription service." };
  } finally {
    clearTimeout(timeout);
  }
}

export async function transcribeAudio(
  audioUrl: string,
  config: SttConfig,
  options: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const { durationSeconds, signal } = options;

  const probe = await probeAudio(audioUrl, signal);
  if (!probe.ok) return probe;

  if (probe.total > MAX_TOTAL_BYTES) {
    return { ok: false, error: TOO_LONG_ERROR };
  }

  // Small enough for one request, or the host won't let us range-fetch it. In
  // the latter case we can only try it whole, so bail if that would exceed the
  // provider cap rather than pulling a huge file into memory to be rejected.
  const canChunk = probe.rangeSupported && probe.total > 0;
  if (probe.total > 0 && probe.total <= PROVIDER_MAX_BYTES) {
    return transcribeWhole(audioUrl, config, signal);
  }
  if (!canChunk) {
    if (probe.total > PROVIDER_MAX_BYTES) {
      return {
        ok: false,
        error:
          "This episode is too large to transcribe — its host doesn't support the range requests needed to split it up.",
      };
    }
    // Unknown size and no range support: attempt it whole and let the size
    // guard inside catch anything over the cap.
    return transcribeWhole(audioUrl, config, signal);
  }

  return transcribeChunked(audioUrl, config, probe.total, durationSeconds, signal);
}

/** The simple path: one download, one transcription. */
async function transcribeWhole(
  audioUrl: string,
  config: SttConfig,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  let audio: Blob;
  try {
    const response = await fetch(audioUrl, { signal });
    if (!response.ok) return { ok: false, error: "Couldn't download the episode audio." };
    audio = await response.blob();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Transcription timed out." };
    }
    return { ok: false, error: "Couldn't download the episode audio." };
  }

  if (audio.size > PROVIDER_MAX_BYTES) {
    // Content-length lied (or was absent) and the real file is over the cap.
    return { ok: false, error: TOO_LONG_ERROR };
  }

  const result = await transcribeBlob(audio, config, signal);
  if (!result.ok) return result;
  if (!result.text) return { ok: false, error: "The transcription came back empty." };

  return {
    ok: true,
    text: result.text,
    segments: result.segments,
    model: `${config.provider}/${config.model}`,
  };
}

/** The large-episode path: range-fetch, transcribe per chunk, stitch timings. */
async function transcribeChunked(
  audioUrl: string,
  config: SttConfig,
  total: number,
  durationSeconds: number | null | undefined,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const ranges = planChunks(total);

  const results = new Array<ChunkResult | null>(ranges.length).fill(null);

  // Transcribe in a bounded pool. Downloading and uploading each chunk in the
  // same task keeps at most TRANSCRIBE_CONCURRENCY chunks resident in memory.
  let nextIndex = 0;
  let failure: string | null = null;

  async function worker() {
    for (;;) {
      const index = nextIndex++;
      if (index >= ranges.length || failure) return;

      const { start, end } = ranges[index];
      try {
        const blob = await fetchRange(audioUrl, start, end, signal);
        const transcribed = await transcribeBlob(blob, config, signal);
        if (!transcribed.ok) {
          failure ??= transcribed.error;
          return;
        }
        results[index] = {
          startByte: start,
          byteLength: end - start,
          segments: transcribed.segments,
        };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          failure ??= "Transcription timed out.";
        } else {
          failure ??= "Couldn't download part of the episode audio.";
        }
        return;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(TRANSCRIBE_CONCURRENCY, ranges.length) }, worker),
  );

  if (failure) return { ok: false, error: failure };

  const chunks = results.filter((r): r is ChunkResult => r !== null);
  if (chunks.length !== ranges.length) {
    return { ok: false, error: "Transcription failed. Please try again." };
  }

  const first = chunks[0];
  const firstChunkDuration =
    first.segments.length > 0 ? Math.max(...first.segments.map((s) => s.end)) : 0;

  const secondsPerByte = calibrateSecondsPerByte({
    total,
    durationSeconds,
    firstChunkBytes: first.byteLength,
    firstChunkDuration,
  });

  const segments = mergeSegments(chunks, secondsPerByte);
  const text = segments.map((s) => s.text).join(" ").trim();
  if (!text) return { ok: false, error: "The transcription came back empty." };

  return { ok: true, text, segments, model: `${config.provider}/${config.model}` };
}

/** Combines an optional caller signal with our own timeout signal. */
function mergeSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  // AbortSignal.any is available on the Node version Vercel runs.
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  return b;
}
