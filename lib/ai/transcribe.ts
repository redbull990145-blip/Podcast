import type { SttConfig } from "./config";
import type { TranscriptSegment, TranscriptWord } from "@/lib/db/schema";
import { prepareChunk } from "./mp3";
import {
  buildM4A,
  parseAudioTrack,
  planSampleGroups,
  readBoxes,
  sampleRange,
  type Mp4AudioTrack,
} from "./mp4";

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

/** How many chunks transcribe at once. Bounded to keep peak memory modest. */
const TRANSCRIBE_CONCURRENCY = 4;

/**
 * Stop starting new chunks past this point.
 *
 * The route is capped at 60s by the platform, and being killed mid-flight
 * returns an opaque 502 with no explanation. Giving up a little early leaves
 * room to answer with something the listener can act on.
 */
const JOB_DEADLINE_MS = 48_000;

const PROBE_TIMEOUT_MS = 20_000;
const CHUNK_FETCH_TIMEOUT_MS = 45_000;
const TRANSCRIBE_TIMEOUT_MS = 60_000;

/** How much to read at a time while hunting for an MP4's `moov` index. */
const MOOV_SCAN_BYTES = 64 * 1024;

/** Stop walking rather than chase boxes forever through a pathological file. */
const MOOV_SCAN_HOPS = 8;

/**
 * A `moov` larger than this is not a podcast index. Refusing beats buffering it
 * — the index is held whole in memory to plan the split.
 */
const MAX_MOOV_BYTES = 32 * 1024 * 1024;

export type TranscriptionResult =
  | { ok: true; text: string; segments: TranscriptSegment[]; model: string }
  | { ok: false; error: string };

type TranscribeOptions = {
  signal?: AbortSignal;
};

type VerboseTranscription = {
  text?: string;
  segments?: { start?: number; end?: number; text?: string }[];
  // Word-level timings, returned when timestamp_granularities[]=word is sent.
  words?: { word?: string; start?: number; end?: number }[];
};

type ChunkResult = {
  segments: TranscriptSegment[];
  /** Per-word timings for this chunk, chunk-relative (start from 0). */
  words: TranscriptWord[];
};

const TOO_LONG_ERROR =
  "This episode is too long to transcribe automatically yet. Try an episode under about six hours.";

const UNSPLITTABLE_ERROR =
  "This episode is too large to transcribe — its host doesn't support the range requests needed to split it up.";

const MP4_UNREADABLE_ERROR =
  "This episode's audio is in a format we couldn't read well enough to split up for transcription.";

/**
 * Which audio container this file uses.
 *
 * Only MP3 can be split on arbitrary byte boundaries: its frames are
 * self-synchronising, so a decoder can pick up mid-file. MP4/M4A wraps AAC in
 * atoms with out-of-band sample tables, so a raw byte slice of the middle of
 * an M4A file is not decodable as anything — every chunked upload comes back
 * from the provider as "could not process file".
 *
 * The classifier consults magic bytes first (the source of truth), then falls
 * back to Content-Type when the payload is too short to be sure. Anything it
 * doesn't recognise is treated as non-MP3, so the caller errs on the safe
 * whole-file path rather than shipping garbage to the provider.
 */
export type AudioKind = "mp3" | "mp4" | "other";

export function detectAudioKind(head: Uint8Array, contentType: string | null): AudioKind {
  if (head.length >= 3) {
    // "ID3" — MP3 with an ID3v2 tag at the start.
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return "mp3";
    // MPEG audio sync word: 0xFF 0xEx/0xFx (Layer III bit set).
    if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "mp3";
  }

  // MP4/M4A: "ftyp" atom, four bytes in.
  if (
    head.length >= 8 &&
    head[4] === 0x66 &&
    head[5] === 0x74 &&
    head[6] === 0x79 &&
    head[7] === 0x70
  ) {
    return "mp4";
  }

  const type = (contentType ?? "").toLowerCase();
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "mp4";

  return "other";
}

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
 * The real duration of one chunk's audio, as Whisper heard it.
 *
 * Within a chunk Whisper's timings are accurate and start from zero, so the end
 * of the latest thing it transcribed is how long that slice of audio actually
 * played for — regardless of the file's bitrate or any advertising stitched in.
 *
 * Words are the finer clock, but older Whisper variants return only segments;
 * either is trustworthy, so prefer the later of the two.
 */
export function chunkDuration(chunk: { segments: TranscriptSegment[]; words: TranscriptWord[] }): number {
  const lastSegment = chunk.segments.reduce((max, s) => Math.max(max, s.end), 0);
  const lastWord = chunk.words.reduce((max, w) => Math.max(max, w.end), 0);
  return Math.max(lastSegment, lastWord);
}

/**
 * Shifts every chunk's segments and words onto one timeline and merges them.
 *
 * Each chunk is a contiguous byte range of the served audio, played back to
 * back. Whisper reports each chunk's timings from zero, and `chunkDuration`
 * measures exactly how long that slice was — so chunk *i* starts at the sum of
 * the durations of every chunk before it. That sum is exact: it does not depend
 * on the file's bitrate or on the feed's reported duration, which is why a
 * stitched-in ad can no longer accumulate error across the episode.
 *
 * After offsetting, words are grouped into whichever segment their start falls
 * inside (so each line carries the per-word timings its fill needs), segments
 * are ordered, and the odd duplicate a frame of overlap at a cut point can
 * produce is dropped.
 */
export function mergeSegments(chunks: ChunkResult[]): TranscriptSegment[] {
  // Cumulative start time for each chunk, computed from measured durations.
  const startTimes: number[] = [];
  let cumulative = 0;
  for (const chunk of chunks) {
    startTimes.push(cumulative);
    cumulative += chunkDuration(chunk);
  }

  type Item = {
    segment: TranscriptSegment;
    offset: number;
    /** Words from the same chunk that fall inside this segment. */
    words: TranscriptWord[];
  };

  const items: Item[] = [];

  chunks.forEach((chunk, index) => {
    const offset = startTimes[index];

    const shiftedWords: TranscriptWord[] = chunk.words
      .map((w) => {
        const text = w.text.trim();
        if (!text) return null;
        return { start: w.start + offset, end: w.end + offset, text };
      })
      .filter((w): w is TranscriptWord => w !== null);

    for (const seg of chunk.segments) {
      const text = seg.text.trim();
      if (!text) continue;

      const start = seg.start + offset;
      const end = seg.end + offset;

      // A word belongs to a segment when it begins inside that segment's span.
      // The upper bound is strict on purpose: a word starting exactly on a
      // segment boundary is the first word of the *next* line, so it is counted
      // there rather than trailing the previous one — which keeps the highlight
      // attached to the line being read.
      const owned = shiftedWords.filter((w) => w.start >= start - 0.01 && w.start < end);

      items.push({
        segment: { start, end, text },
        offset,
        words: owned,
      });
    }
  });

  items.sort((a, b) => a.segment.start - b.segment.start);

  const merged: TranscriptSegment[] = [];
  for (const { segment, words } of items) {
    const prev = merged[merged.length - 1];
    // A cut can make the same line appear at the tail of one chunk and the head
    // of the next; skip a near-identical repeat rather than show it twice.
    if (prev && prev.text === segment.text && Math.abs(prev.start - segment.start) < 1.5) {
      continue;
    }
    merged.push(words.length > 0 ? { ...segment, words } : segment);
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
  | { ok: true; total: number; rangeSupported: boolean; kind: AudioKind }
  | { ok: false; error: string }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const combined = mergeSignals(signal, controller.signal);

  try {
    // Pull the first 128 bytes rather than a single byte: it costs nothing
    // extra over the round trip and lets us sniff MP3-vs-MP4 magic bytes at
    // the same time, which decides whether the file can be chunked.
    const response = await fetch(url, {
      headers: { range: "bytes=0-127" },
      signal: combined,
    });

    const contentType = response.headers.get("content-type");

    if (response.status === 206) {
      const match = /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "");
      const head = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
      const kind = detectAudioKind(head, contentType);
      const total = match ? Number(match[1]) : 0;
      if (total > 0) return { ok: true, total, rangeSupported: true, kind };
      return { ok: true, total: 0, rangeSupported: false, kind };
    }

    if (response.ok) {
      const total = Number(response.headers.get("content-length") ?? 0);
      const head = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
      const kind = detectAudioKind(head, contentType);
      return { ok: true, total, rangeSupported: false, kind };
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

/**
 * Fetches one byte range and trims it to a clean frame boundary.
 *
 * See lib/ai/mp3.ts for why the first chunk in particular must not keep the
 * file's original header.
 */
async function fetchChunk(
  url: string,
  start: number,
  end: number,
  isFirst: boolean,
  signal?: AbortSignal,
): Promise<Blob> {
  const bytes = await fetchRange(url, start, end, CHUNK_FETCH_TIMEOUT_MS, signal);
  const prepared = prepareChunk(bytes, isFirst);
  // Re-wrap the view's bytes: a subarray shares its parent's buffer, and the
  // Blob constructor's type only accepts a plain ArrayBuffer view.
  return new Blob([prepared.slice().buffer], { type: "audio/mpeg" });
}

/**
 * Sends one audio blob to the provider and returns its (chunk-relative) segments
 * and word timings.
 *
 * The error is a discriminated result rather than a throw so the orchestrator
 * can tell a retryable rate-limit apart from a rejected key.
 */
async function transcribeBlob(
  audio: Blob,
  config: SttConfig,
  signal?: AbortSignal,
): Promise<
  | { ok: true; text: string; segments: TranscriptSegment[]; words: TranscriptWord[] }
  | { ok: false; error: string }
> {
  const form = new FormData();
  form.append("file", audio, "episode.mp3");
  form.append("model", config.model);
  // Verbose JSON returns per-segment timings, which is what makes a citation
  // clickable — without them an answer can only quote, not seek.
  form.append("response_format", "verbose_json");
  // Word-level timestamps are the ground truth the caption fill tracks. Both
  // segments and words are requested: segments drive the line layout and
  // citations, words drive per-word highlighting and the chunk's true duration.
  form.append("timestamp_granularities[]", "segment");
  form.append("timestamp_granularities[]", "word");

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
        return { ok: false, error: rateLimitMessage(response) };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: "The transcription API key was rejected." };
      }
      // Never surface the raw provider body to the client — it can echo the key.
      console.error("Transcription failed", response.status, detail.slice(0, 300));
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

    const words: TranscriptWord[] = (data.words ?? [])
      .map((w) => ({ start: Number(w.start ?? 0), end: Number(w.end ?? 0), text: (w.word ?? "").trim() }))
      .filter((w) => w.text.length > 0 && Number.isFinite(w.start) && Number.isFinite(w.end));

    return { ok: true, text, segments, words };
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
  const { signal } = options;

  const probe = await probeAudio(audioUrl, signal);
  if (!probe.ok) return probe;

  if (probe.total > MAX_TOTAL_BYTES) {
    return { ok: false, error: TOO_LONG_ERROR };
  }

  // Small enough to send in one request — always the simplest thing that works.
  if (probe.total > 0 && probe.total <= PROVIDER_MAX_BYTES) {
    return transcribeWhole(audioUrl, config, signal);
  }

  // Splitting needs both a known size and a host that honours byte ranges.
  const canChunk = probe.rangeSupported && probe.total > 0;
  if (!canChunk) {
    if (probe.total > PROVIDER_MAX_BYTES) {
      return { ok: false, error: UNSPLITTABLE_ERROR };
    }
    // Unknown size and no range support: attempt it whole and let the size
    // guard inside catch anything over the cap.
    return transcribeWhole(audioUrl, config, signal);
  }

  // How a file is split depends entirely on its container. MP3 frames are
  // self-syncing, so a byte range is already valid audio; MP4 keeps its frames
  // in an opaque blob described by a separate index, so each piece has to be
  // repackaged into a real file. See lib/ai/mp4.ts.
  if (probe.kind === "mp4") {
    return transcribeMp4Chunked(audioUrl, config, probe.total, signal);
  }
  if (probe.kind !== "mp3") {
    // Something we can't identify. A byte split would probably produce
    // undecodable pieces, so try it whole and let the size guard answer.
    return transcribeWhole(audioUrl, config, signal);
  }

  return transcribeMp3Chunked(audioUrl, config, probe.total, signal);
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

/**
 * Runs `count` chunks through the provider in a bounded pool and stitches the
 * results onto one timeline.
 *
 * How a chunk is produced is left to the caller, because that is the only part
 * that differs between containers — everything after "here is a piece of
 * playable audio" is identical. Downloading and uploading a chunk in the same
 * task keeps at most TRANSCRIBE_CONCURRENCY of them resident in memory.
 */
async function transcribeChunks(
  count: number,
  makeChunk: (index: number, signal?: AbortSignal) => Promise<Blob>,
  config: SttConfig,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const results = new Array<ChunkResult | null>(count).fill(null);

  let nextIndex = 0;
  let failure: string | null = null;
  const deadline = Date.now() + JOB_DEADLINE_MS;

  async function worker() {
    for (;;) {
      const index = nextIndex++;
      if (index >= count || failure) return;

      if (Date.now() > deadline) {
        failure ??=
          "This episode is too long to finish transcribing in one go. Adding your own Groq or OpenAI key in Settings lifts the shared limits that slow this down.";
        return;
      }

      try {
        const blob = await makeChunk(index, signal);
        const transcribed = await transcribeBlob(blob, config, signal);
        if (!transcribed.ok) {
          failure ??= transcribed.error;
          return;
        }
        results[index] = {
          segments: transcribed.segments,
          words: transcribed.words,
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

  await Promise.all(Array.from({ length: Math.min(TRANSCRIBE_CONCURRENCY, count) }, worker));

  if (failure) return { ok: false, error: failure };

  const chunks = results.filter((r): r is ChunkResult => r !== null);
  if (chunks.length !== count) {
    return { ok: false, error: "Transcription failed. Please try again." };
  }

  const segments = mergeSegments(chunks);
  const text = segments.map((s) => s.text).join(" ").trim();
  if (!text) return { ok: false, error: "The transcription came back empty." };

  return { ok: true, text, segments, model: `${config.provider}/${config.model}` };
}

/** MP3: every byte range is already playable once trimmed to a frame boundary. */
async function transcribeMp3Chunked(
  audioUrl: string,
  config: SttConfig,
  total: number,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const ranges = planChunks(total);

  return transcribeChunks(
    ranges.length,
    (index, sig) => {
      const { start, end } = ranges[index];
      return fetchChunk(audioUrl, start, end, index === 0, sig);
    },
    config,
    signal,
  );
}

/**
 * MP4/M4A: read the sample index once, then repackage each group of frames into
 * a standalone little M4A.
 *
 * The index (`moov`) is fetched up front because nothing about the file can be
 * planned without it — it is what says where each audio frame lives. After that
 * each chunk costs exactly one ranged fetch, the same as the MP3 path.
 */
async function transcribeMp4Chunked(
  audioUrl: string,
  config: SttConfig,
  total: number,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const moov = await locateMoov(audioUrl, total, signal);
  if (!moov) return { ok: false, error: MP4_UNREADABLE_ERROR };

  const track = parseAudioTrack(moov);
  if (!track) return { ok: false, error: MP4_UNREADABLE_ERROR };

  const groups = planSampleGroups(track.samples, CHUNK_TARGET_BYTES);
  if (groups.length === 0) return { ok: false, error: MP4_UNREADABLE_ERROR };

  return transcribeChunks(
    groups.length,
    (index, sig) => buildMp4Chunk(audioUrl, track, groups[index], sig),
    config,
    signal,
  );
}

/** Fetches one group's audio frames and wraps them in a playable M4A. */
async function buildMp4Chunk(
  audioUrl: string,
  track: Mp4AudioTrack,
  group: { start: number; end: number },
  signal?: AbortSignal,
): Promise<Blob> {
  const range = sampleRange(track.samples, group.start, group.end);
  const data = await fetchRange(audioUrl, range.start, range.end, CHUNK_FETCH_TIMEOUT_MS, signal);

  const samples = track.samples.slice(group.start, group.end);
  const file = buildM4A(track, samples, data, range.start);

  return new Blob([file.slice().buffer], { type: "audio/mp4" });
}

/**
 * Finds and downloads an MP4's `moov` index, wherever it happens to live.
 *
 * Position is not fixed: encoders that optimise for streaming put it at the
 * front, and plenty of others leave it at the end, after the audio. Rather than
 * guess, this walks the top-level boxes — each one declares its own length, so
 * a small read at the right place is enough to hop to the next.
 */
async function locateMoov(
  url: string,
  total: number,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  let cursor = 0;

  for (let hop = 0; hop < MOOV_SCAN_HOPS && cursor < total; hop += 1) {
    let window: Uint8Array;
    try {
      window = await fetchRange(
        url,
        cursor,
        Math.min(cursor + MOOV_SCAN_BYTES, total),
        PROBE_TIMEOUT_MS,
        signal,
      );
    } catch {
      return null;
    }

    const boxes = readBoxes(window);
    if (boxes.length === 0) return null;

    const moov = boxes.find((b) => b.type === "moov");
    if (moov) {
      if (moov.end - moov.start > MAX_MOOV_BYTES) return null;

      // Already fully inside the window we happened to read.
      if (moov.end <= window.length) return window.slice(moov.dataStart, moov.end);

      // Otherwise fetch exactly the index, now that its length is known.
      try {
        const full = await fetchRange(
          url,
          cursor + moov.start,
          Math.min(cursor + moov.end, total),
          CHUNK_FETCH_TIMEOUT_MS,
          signal,
        );
        const [box] = readBoxes(full);
        if (!box || box.type !== "moov") return null;
        return full.slice(box.dataStart, Math.min(box.end, full.length));
      } catch {
        return null;
      }
    }

    // No index here. The last box's declared length says where the next one
    // starts, which is how the audio blob gets skipped without downloading it.
    const next = cursor + boxes[boxes.length - 1].end;
    if (next <= cursor) return null;
    cursor = next;
  }

  return null;
}

/** Fetches a byte range as raw bytes. Throws on transport or status failure. */
async function fetchRange(
  url: string,
  start: number,
  end: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const combined = mergeSignals(signal, controller.signal);

  try {
    const response = await fetch(url, {
      // `end` is exclusive here but inclusive in an HTTP range header.
      headers: { range: `bytes=${start}-${end - 1}` },
      signal: combined,
    });
    if (!response.ok) throw new Error(`range fetch failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Turns a provider 429 into something the listener can act on.
 *
 * The free tier's binding limit is audio-seconds per hour, shared across
 * everyone using this deployment — so "try again shortly" is misleading when
 * the real answer is closer to forty minutes. The reset headers say exactly
 * how long, and saying so beats letting someone retry in a loop.
 */
export function rateLimitMessage(response: {
  headers: { get(name: string): string | null };
}): string {
  const reset =
    response.headers.get("x-ratelimit-reset-audio-seconds") ??
    response.headers.get("retry-after");

  const friendly = formatResetWindow(reset);
  return friendly
    ? `Daily transcription capacity is used up for now — it frees up in about ${friendly}. Add your own Groq or OpenAI key in Settings to skip the shared limit.`
    : "Transcription capacity is used up for now. Try again later, or add your own Groq or OpenAI key in Settings to skip the shared limit.";
}

/** "59m20s" / "27.5" (seconds) / "43.2s" -> "an hour", "28 seconds", "44 seconds". */
export function formatResetWindow(raw: string | null): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  // Bare numbers in a Retry-After header are seconds.
  const bare = Number(trimmed);
  const match = /^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s?)?$/.exec(trimmed);

  let seconds: number;
  if (Number.isFinite(bare) && trimmed !== "") {
    seconds = bare;
  } else if (match && (match[1] || match[2])) {
    seconds = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  } else {
    return null;
  }

  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 90) return `${Math.ceil(seconds)} seconds`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;
  return minutes < 90 ? "an hour" : `${Math.round(minutes / 60)} hours`;
}

/** Combines an optional caller signal with our own timeout signal. */
function mergeSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  // AbortSignal.any is available on the Node version Vercel runs.
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  return b;
}
