import { colabSttConfig, type SttConfig } from "./config";
import type { TranscriptSegment, TranscriptWord } from "@/lib/db/schema";
import { collapseLoops } from "@/lib/transcript/repetition";
import { repairTranscript } from "@/lib/player/transcript-integrity";
import { publisherHeaders } from "@/lib/user-agent";
import { measureFrames, prepareChunk } from "./mp3";
import {
  buildM4A,
  groupSeconds,
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
/**
 * Default ceiling on one transcription request, sized for a hosted provider
 * that answers faster than real time. A self-hosted model overrides it via
 * `SttConfig.requestTimeoutMs` — see colabSttConfig.
 */
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

/**
 * How long to wait for a dev Whisper server to answer a health check.
 *
 * Short on purpose: the two failure modes worth distinguishing are "answered,
 * so wait for the real transcription" and "notebook isn't running right now",
 * and the second should fall back to Groq in a couple of seconds, not after
 * the connection eventually times out on its own.
 */
const COLAB_HEALTH_TIMEOUT_MS = 4_000;

export type TranscriptionResult =
  | {
      ok: true;
      text: string;
      segments: TranscriptSegment[];
      model: string;
      /**
       * Length of the audio these timings were measured against, in seconds.
       *
       * Stored with the transcript, and the whole reason it exists: hosts that
       * stitch advertising in serve a different cut per request, so the file the
       * listener streams is not the file this was timed against. Without a
       * record of what *was* measured there is no way to tell a transcript that
       * still matches from one that silently no longer does. Null when the
       * container could not be measured.
       */
      audioSeconds: number | null;
      /**
       * Size and validator of the served copy these timings came from.
       *
       * Diagnostic only — nothing reads them to make a decision. They exist
       * because a re-stitched episode is otherwise invisible after the fact:
       * when someone reports captions drifting, one `HEAD` against the enclosure
       * URL compared with these says immediately whether the host is serving a
       * different file than the one we transcribed, which is the difference
       * between a bug in this code and a bug in the premise.
       *
       * Null on the local-server path, which fetches the URL itself and never
       * shows us the response.
       */
      audioBytes?: number | null;
      audioEtag?: string | null;
    }
  | { ok: false; error: string };

/**
 * One specific served copy of an episode's audio.
 *
 * Podcast enclosure URLs are not stable files on the hosts that matter here.
 * Megaphone, Omny, Art19 and the Podtrac chains stitch advertising in at request
 * time, so two `GET`s of the same URL return different bytes of different
 * lengths — the content segments are identical, the ad pods are not.
 *
 * A chunked transcription reads the file in up to four concurrent byte ranges,
 * and every one of them used to re-resolve the enclosure URL from scratch. Each
 * could therefore land on a different stitch, which is not a subtle problem:
 * `mergeSegments` places each chunk at the running sum of the measured durations
 * before it, so one mismatched chunk shifts every caption after it.
 *
 * Pinning the post-redirect URL is what actually prevents it — the stitching
 * happens while the redirect chain is resolved, and the CDN object it lands on
 * is stable. The length and validators are carried alongside so a change can
 * still be *detected* if one slips through.
 *
 * ## Is it safe to hold one of these for the length of a job?
 *
 * Yes, and it was worth checking, because the URL these hosts resolve to is
 * signed per request rather than canonical. Megaphone's looks like
 * `dcs-spotify.megaphone.fm/…?key=…&session_id=…&timetoken=<epoch>_<hmac>`, and
 * a signature that expired mid-job would turn a caption bug into a 403.
 *
 * Measured against a live episode: the `timetoken` is stamped two hours ahead
 * of the request, and ranged reads 60MB into the file kept returning 206 with
 * an unchanged total four minutes later. Two hours against a 48-second job
 * deadline is not a close call.
 *
 * It also cannot be single-use, on any host, for a reason that needs no
 * measuring: a browser streams audio with repeated ranged requests against one
 * resolved URL, so a URL that only worked once would not play.
 */
type Rendition = {
  /** The URL after redirects. Every range request must use this, not the feed's. */
  url: string;
  total: number;
  etag: string | null;
  lastModified: string | null;
};

/**
 * Whether a ranged response came from a different cut than the one we planned
 * against.
 *
 * Only the total length is treated as proof, and that asymmetry is deliberate.
 * A different set of ads is a different number of bytes, so the total is both
 * the most reliable signal available and the one that actually matters: if it
 * still agrees, every byte offset we planned still points at the same audio.
 *
 * `ETag` and `Last-Modified` are reported but not trusted to fail a job. CDNs in
 * front of these hosts vary them per edge and per request even for identical
 * content, so treating a mismatch as fatal would refuse to transcribe shows that
 * work correctly today. A changed validator with an unchanged length is worth
 * knowing about and is not evidence of anything on its own.
 */
export function renditionMismatch(
  rendition: Pick<Rendition, "total" | "etag" | "lastModified">,
  headers: { get(name: string): string | null },
): { fatal: boolean; detail: string } | null {
  const contentRange = headers.get("content-range") ?? "";
  const match = /\/(\d+)\s*$/.exec(contentRange);
  const total = match ? Number(match[1]) : null;

  if (total !== null && rendition.total > 0 && total !== rendition.total) {
    return {
      fatal: true,
      detail: `length changed from ${rendition.total} to ${total} bytes`,
    };
  }

  const etag = normaliseEtag(headers.get("etag"));
  const expected = normaliseEtag(rendition.etag);
  if (etag && expected && etag !== expected) {
    return { fatal: false, detail: `etag changed from ${expected} to ${etag}` };
  }

  const modified = headers.get("last-modified");
  if (modified && rendition.lastModified && modified !== rendition.lastModified) {
    return {
      fatal: false,
      detail: `last-modified changed from ${rendition.lastModified} to ${modified}`,
    };
  }

  return null;
}

/** Strips the weak-validator prefix so `W/"x"` and `"x"` compare equal. */
function normaliseEtag(value: string | null): string | null {
  if (!value) return null;
  return value.trim().replace(/^W\//, "");
}

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
  /**
   * Measured playback duration of this chunk's audio, when the container could
   * be parsed for it. This — not what Whisper transcribed — is what places the
   * following chunks on the timeline. See `chunkDuration` for why.
   */
  seconds?: number | null;
};

/** One chunk's audio, with the duration measured off the container. */
type PreparedChunk = {
  blob: Blob;
  /** Null when the bytes couldn't be parsed; the caller then falls back. */
  seconds: number | null;
};

const TOO_LONG_ERROR =
  "This episode is too long to transcribe automatically yet. Try an episode under about six hours.";

const UNSPLITTABLE_ERROR =
  "This episode is too large to transcribe — its host doesn't support the range requests needed to split it up.";

const MP4_UNREADABLE_ERROR =
  "This episode's audio is in a format we couldn't read well enough to split up for transcription.";

const NO_TRANSCRIPTION_PROVIDER_ERROR =
  "No transcription provider is available for this request.";

const LOCAL_SERVER_UNREACHABLE_ERROR =
  "Your local Whisper server didn't respond. Check the Colab notebook is still running, and that COLAB_WHISPER_URL matches the URL its last cell printed — the tunnel gets a new address every restart.";

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
 * How much of a chunk Whisper transcribed, in seconds.
 *
 * A lower bound on the chunk's real duration, and only that — it is where the
 * last word landed, which equals the length of the audio only when the chunk
 * happens to end on speech. It never does: boundaries fall in music beds,
 * pauses and outros, and everything after the final word is invisible here.
 *
 * That makes it the wrong ruler for placing the *next* chunk. Because a
 * boundary can only lose time and never gain it, the error is one-directional
 * and accumulates, so captions run progressively early and the drift grows with
 * the length of the episode — measured at seconds by the end of a three-hour
 * show. `frameSeconds` and `groupSeconds` measure the container instead, and
 * `mergeSegments` prefers them; this remains only as the fallback for audio
 * neither of them could parse, where a small accumulating error still beats
 * having no timeline at all.
 *
 * Words are the finer clock, but older Whisper variants return only segments;
 * either is usable, so prefer the later of the two.
 */
export function chunkDuration(chunk: { segments: TranscriptSegment[]; words: TranscriptWord[] }): number {
  const lastSegment = chunk.segments.reduce((max, s) => Math.max(max, s.end), 0);
  const lastWord = chunk.words.reduce((max, w) => Math.max(max, w.end), 0);
  return Math.max(lastSegment, lastWord);
}

/** How long `word` and `segment` overlap on the timeline, in seconds. */
function overlapSeconds(
  word: { start: number; end: number },
  segment: { start: number; end: number },
): number {
  return Math.min(word.end, segment.end) - Math.max(word.start, segment.start);
}

/**
 * Gives every word to the line it belongs to.
 *
 * Both lists are already in time order, so this is one walk rather than a scan
 * per line — which matters at the scale a three-hour episode reaches, where the
 * old filter-per-segment was tens of millions of comparisons.
 *
 * A word is placed by how much of it falls inside a line, not by where it
 * happens to begin. Whisper's segment boundaries and its word timings are
 * produced by different passes and disagree by a few hundredths of a second at
 * the seams, so a word starting a hair before its line's start used to be filed
 * against the previous line — or, at the very first line, dropped entirely.
 * Every drop cost that line its per-word timings, and the caption fill fell back
 * to sweeping the whole sentence. Assigning by overlap means every word lands
 * somewhere, and lands where it is actually said.
 */
function assignWords(
  segments: { start: number; end: number }[],
  words: TranscriptWord[],
): TranscriptWord[][] {
  const owned: TranscriptWord[][] = segments.map(() => []);
  if (segments.length === 0) return owned;

  let index = 0;
  for (const word of words) {
    // Skip past lines that are over before this word begins.
    while (index + 1 < segments.length && segments[index].end <= word.start) {
      index += 1;
    }

    // A word straddling a boundary goes to whichever side holds more of it.
    let best = index;
    if (
      index + 1 < segments.length &&
      overlapSeconds(word, segments[index + 1]) > overlapSeconds(word, segments[index])
    ) {
      best = index + 1;
    }

    owned[best].push(word);
  }

  return owned;
}

/**
 * Shifts every chunk's segments and words onto one timeline and merges them.
 *
 * Each chunk is a contiguous byte range of the served audio, played back to
 * back, and Whisper reports each chunk's timings from zero. So chunk *i* starts
 * at the sum of the durations of every chunk before it, and the whole transcript
 * is only as well aligned as that sum.
 *
 * The durations come from the container — MP3 frame headers or the MP4 sample
 * table — which is exact for VBR as well as CBR and owes nothing to the feed's
 * declared duration. Whisper's own output is the fallback for audio neither
 * parser could read; see `chunkDuration` for why it is a fallback and not the
 * primary, and plans/005-caption-sync-accuracy.md for what it cost.
 *
 * After offsetting, words are grouped into the line they are spoken in (so each
 * line carries the per-word timings its fill needs), segments are ordered, and
 * the odd duplicate a frame of overlap at a cut point can produce is dropped.
 */
export function mergeSegments(chunks: ChunkResult[]): TranscriptSegment[] {
  // Cumulative start time for each chunk, from the measured audio where the
  // container gave it up and from the transcript where it didn't.
  const startTimes: number[] = [];
  let cumulative = 0;
  for (const chunk of chunks) {
    startTimes.push(cumulative);
    cumulative +=
      typeof chunk.seconds === "number" && chunk.seconds > 0
        ? chunk.seconds
        : chunkDuration(chunk);
  }

  type Item = {
    segment: TranscriptSegment;
    /** Words from the same chunk that are spoken in this segment. */
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

    const shiftedSegments = chunk.segments
      .map((seg) => ({
        start: seg.start + offset,
        end: seg.end + offset,
        text: seg.text.trim(),
      }))
      .filter((seg) => seg.text.length > 0)
      // `assignWords` walks both lists once, which only works if they are in
      // time order. Providers return them that way; sorting says so rather
      // than trusting it.
      .sort((a, b) => a.start - b.start);

    shiftedWords.sort((a, b) => a.start - b.start);

    const owned = assignWords(shiftedSegments, shiftedWords);

    shiftedSegments.forEach((segment, i) => {
      items.push({ segment, words: owned[i] });
    });
  });

  items.sort((a, b) => a.segment.start - b.segment.start);

  const merged: TranscriptSegment[] = [];
  for (const { segment: raw, words } of items) {
    // Cleaned before storage, not just before display: this text is also what
    // show notes and chapters are generated from, and a page of one repeated
    // word becomes the model's impression of what the episode was about.
    const segment = collapseLoops(words.length > 0 ? { ...raw, words } : raw);
    const prev = merged[merged.length - 1];
    // A cut can make the same line appear at the tail of one chunk and the head
    // of the next; skip a near-identical repeat rather than show it twice.
    if (prev && prev.text === segment.text && Math.abs(prev.start - segment.start) < 1.5) {
      continue;
    }
    // `segment` already carries its words — reattaching the originals here
    // would put back the copies the collapse just removed.
    merged.push(segment);
  }

  /*
   * The last step before this becomes the stored timeline.
   *
   * Chunk boundaries are exactly where the invariants break: each chunk's
   * timings are shifted by the *measured* duration of everything before it, and
   * a measurement that lands a frame long puts the first line of a chunk before
   * the last line of the one it follows. Every consumer downstream — the active
   * line scan, the word anchoring, the fill — assumes that cannot happen. Fixing
   * it once here means it cannot, rather than each of them being separately
   * careful about it and disagreeing.
   */
  return repairTranscript(merged).segments;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/**
 * Discovers the total size, whether the host honours range requests, and which
 * served copy we are looking at.
 *
 * `response.url` is the URL after redirects, and capturing it is the single most
 * important thing this function does for a dynamically-stitched show: it is the
 * CDN object the redirect chain resolved to, and reusing it for every subsequent
 * range request is what keeps a job reading one consistent cut of the episode.
 * See `Rendition`.
 */
async function probeAudio(
  url: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; rendition: Rendition; rangeSupported: boolean; kind: AudioKind }
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
      headers: publisherHeaders({ range: "bytes=0-127" }),
      signal: combined,
    });

    const contentType = response.headers.get("content-type");

    // The URL after redirects, plus whatever validators the host offered. Every
    // range request from here on uses these rather than the feed's URL.
    const resolved = {
      url: response.url || url,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };

    if (response.status === 206) {
      const match = /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "");
      const head = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
      const kind = detectAudioKind(head, contentType);
      const total = match ? Number(match[1]) : 0;
      return {
        ok: true,
        rendition: { ...resolved, total },
        rangeSupported: total > 0,
        kind,
      };
    }

    if (response.ok) {
      const total = Number(response.headers.get("content-length") ?? 0);
      const head = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
      const kind = detectAudioKind(head, contentType);
      return { ok: true, rendition: { ...resolved, total }, rangeSupported: false, kind };
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
 * How much of a chunk may be unreadable before its measured duration is thrown
 * away rather than trusted.
 *
 * `measureFrames` reports the bytes it could account for as neither audio nor a
 * declared tag. A little of that is normal around a splice; a lot means the
 * duration it returned is short by an unknown amount, and a duration that is
 * short by an unknown amount is the worst possible input to `mergeSegments` —
 * it pushes every later chunk early and looks like a real measurement while
 * doing it. Past this, `chunkDuration`'s honest lower bound is the better bet.
 *
 * 2% of a 20MB chunk is roughly 25 seconds of audio at 128kbps, which is well
 * beyond anything a legitimate splice point accounts for.
 */
const MAX_UNREADABLE_RATIO = 0.02;

/**
 * Fetches one byte range and trims it to a clean frame boundary.
 *
 * See lib/ai/mp3.ts for why the first chunk in particular must not keep the
 * file's original header.
 */
async function fetchChunk(
  rendition: Rendition,
  start: number,
  end: number,
  isFirst: boolean,
  signal?: AbortSignal,
): Promise<PreparedChunk> {
  const bytes = await fetchRange(rendition, start, end, CHUNK_FETCH_TIMEOUT_MS, signal);
  const prepared = prepareChunk(bytes, isFirst);

  // Measured on the prepared bytes rather than the raw range, so it is the
  // duration of exactly the audio the provider is about to hear — the leading
  // partial frame, and the first chunk's ID3 tag and Xing header, are already
  // gone and must not be counted.
  const measured = measureFrames(prepared);
  const unreadable = prepared.length > 0 ? measured.skippedBytes / prepared.length : 1;
  const trustworthy = measured.framesCounted > 0 && unreadable <= MAX_UNREADABLE_RATIO;

  if (!trustworthy && measured.framesCounted > 0) {
    console.warn(
      `Chunk at ${start} had ${(unreadable * 100).toFixed(1)}% unreadable bytes; ` +
        "falling back to the transcript's own duration to place it.",
    );
  }

  return {
    // Re-wrap the view's bytes: a subarray shares its parent's buffer, and the
    // Blob constructor's type only accepts a plain ArrayBuffer view.
    blob: new Blob([prepared.slice().buffer], { type: "audio/mpeg" }),
    seconds: trustworthy ? measured.seconds : null,
  };
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
  const timeout = setTimeout(
    () => controller.abort(),
    config.requestTimeoutMs ?? TRANSCRIBE_TIMEOUT_MS,
  );
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
  const maxUploadBytes = config.maxUploadBytes ?? PROVIDER_MAX_BYTES;

  const probe = await probeAudio(audioUrl, signal);
  if (!probe.ok) return probe;

  const { rendition } = probe;

  if (rendition.total > MAX_TOTAL_BYTES) {
    return { ok: false, error: TOO_LONG_ERROR };
  }

  /** Stamps a successful result with which served copy it came from. */
  const from = (result: Promise<TranscriptionResult>) =>
    result.then((r) =>
      r.ok
        ? { ...r, audioBytes: rendition.total || null, audioEtag: rendition.etag }
        : r,
    );

  // Small enough to send in one request — always the simplest thing that works,
  // and immune to the re-stitching problem by construction: one request, one cut.
  if (rendition.total > 0 && rendition.total <= maxUploadBytes) {
    return from(transcribeWhole(rendition.url, config, signal));
  }

  // Splitting needs both a known size and a host that honours byte ranges.
  const canChunk = probe.rangeSupported && rendition.total > 0;
  if (!canChunk) {
    if (rendition.total > maxUploadBytes) {
      return { ok: false, error: UNSPLITTABLE_ERROR };
    }
    // Unknown size and no range support: attempt it whole and let the size
    // guard inside catch anything over the cap.
    return from(transcribeWhole(rendition.url, config, signal));
  }

  // How a file is split depends entirely on its container. MP3 frames are
  // self-syncing, so a byte range is already valid audio; MP4 keeps its frames
  // in an opaque blob described by a separate index, so each piece has to be
  // repackaged into a real file. See lib/ai/mp4.ts.
  if (probe.kind === "mp4") {
    return from(transcribeMp4Chunked(rendition, config, signal));
  }
  if (probe.kind !== "mp3") {
    // Something we can't identify. A byte split would probably produce
    // undecodable pieces, so try it whole and let the size guard answer.
    return from(transcribeWhole(rendition.url, config, signal));
  }

  return from(transcribeMp3Chunked(rendition, config, signal));
}

/**
 * Transcribes with a developer's local Whisper server first, falling back to
 * `fallback` (the tier the caller already resolved — Groq, or the user's own
 * key) when it isn't available or fails.
 *
 * This is the entry point routes should call instead of `transcribeAudio`
 * directly. When `COLAB_WHISPER_URL` isn't set, `colabSttConfig()` returns
 * null and this is exactly equivalent to calling `transcribeAudio` with
 * `fallback` — nobody who hasn't opted in pays for the health check.
 *
 * A cheap `/health` probe runs before spending any time on the actual
 * episode: a Colab notebook that isn't running should fail in a couple of
 * seconds, not after downloading fifty megabytes toward a server that was
 * never going to answer.
 *
 * A null `fallback` means local-only. The caller uses that to say "this
 * request is allowed to run *because* it costs nothing" — someone past their
 * daily allowance, say — where quietly falling back to an operator-funded
 * provider is the one thing that must not happen.
 */
export async function transcribeWithFallback(
  audioUrl: string,
  fallback: SttConfig | null,
  options: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const colab = colabSttConfig();

  if (!colab) {
    return fallback
      ? transcribeAudio(audioUrl, fallback, options)
      : { ok: false, error: NO_TRANSCRIPTION_PROVIDER_ERROR };
  }

  if (!(await isReachable(colab.baseUrl, colab.apiKey, options.signal))) {
    console.warn(
      `Local Whisper server unreachable at ${colab.baseUrl}; ` +
        (fallback ? `using ${fallback.provider}.` : "no fallback permitted."),
    );
    return fallback
      ? transcribeAudio(audioUrl, fallback, options)
      : { ok: false, error: LOCAL_SERVER_UNREACHABLE_ERROR };
  }

  const result = await transcribeViaLocalServer(audioUrl, colab, options.signal);
  if (result.ok || !fallback) return result;

  console.warn(`Local transcription failed (${result.error}), retrying with ${fallback.provider}.`);
  return transcribeAudio(audioUrl, fallback, options);
}

/** How often to ask the local server whether it has finished. */
const LOCAL_POLL_INTERVAL_MS = 3_000;

type LocalJobStatus = {
  status?: "queued" | "downloading" | "transcribing" | "done" | "error";
  error?: string;
  text?: string;
  segments?: { start?: number; end?: number; text?: string }[];
  words?: { word?: string; start?: number; end?: number }[];
  /** Length of the audio the server decoded, in seconds. */
  duration?: number;
};

/**
 * How much of the audio's length the timings must span to be believable.
 *
 * A transcript's last caption always stops short of the file's end — outros,
 * music and trailing silence are not speech. A fifth of the episode is generous
 * room for that. Falling well below it would mean the timings are not on the
 * same clock as the audio, which is the one thing captions cannot survive:
 * every line would be early by an amount that grows through the episode, so
 * there is no offset that fixes it and no way for a listener to correct it.
 *
 * No provider here is known to do that — the current notebook measured 99.9%
 * coverage on a three-hour episode. This is an assertion, not a fix: it costs
 * one comparison, and it turns a whole class of silent timeline corruption into
 * a refusal rather than a transcript cached for every user of the episode.
 */
const MIN_TIMELINE_COVERAGE = 0.8;

const COMPRESSED_TIMELINE_ERROR =
  "The local Whisper server returned timings that don't span the episode, so captions would drift further out of sync the longer it played. Check the notebook's output for the job — it prints how much of the audio the timings covered.";

/**
 * Runs an episode through a local Whisper server by handing over its URL.
 *
 * Deliberately unlike every other path in this file, which downloads the audio
 * here and forwards the bytes. A developer's server sits behind a tunnel that
 * abandons any request unanswered after about a hundred seconds, and pushing a
 * whole episode through it — in pieces small enough to beat that clock — meant
 * moving every byte twice, over the slowest link involved, while issuing one
 * range request per piece to a podcast host that eventually refused them.
 *
 * Sending the URL sidesteps all of it: the server fetches the file once, from
 * a datacentre, and this polls a job id until it is done. No upload, no
 * chunking, no per-request time limit to design around.
 *
 * Only local servers can be used this way — a hosted provider takes bytes, not
 * URLs, and would have no business fetching a URL we handed it.
 */
async function transcribeViaLocalServer(
  audioUrl: string,
  config: SttConfig,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const auth: Record<string, string> = config.apiKey
    ? { authorization: `Bearer ${config.apiKey}` }
    : {};
  const deadline = Date.now() + (config.jobDeadlineMs ?? JOB_DEADLINE_MS);

  let jobId: string;
  try {
    const response = await fetchJson(
      `${config.baseUrl}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ url: audioUrl }),
      },
      config.requestTimeoutMs ?? TRANSCRIBE_TIMEOUT_MS,
      signal,
    );
    const created = response as { job_id?: string };
    if (!created.job_id) return { ok: false, error: LOCAL_SERVER_UNREACHABLE_ERROR };
    jobId = created.job_id;
  } catch {
    return { ok: false, error: LOCAL_SERVER_UNREACHABLE_ERROR };
  }

  // Consecutive poll failures, so one dropped request doesn't abandon a job
  // that is running perfectly well — tunnels hiccup.
  let misses = 0;

  for (;;) {
    if (Date.now() > deadline) {
      return {
        ok: false,
        error:
          "The local Whisper server is taking longer than expected. Check the Colab notebook's output — it prints progress for each stage.",
      };
    }

    await sleep(config.pollIntervalMs ?? LOCAL_POLL_INTERVAL_MS, signal);

    let job: LocalJobStatus;
    try {
      job = (await fetchJson(
        `${config.baseUrl}/jobs/${jobId}`,
        { headers: auth },
        config.requestTimeoutMs ?? TRANSCRIBE_TIMEOUT_MS,
        signal,
      )) as LocalJobStatus;
      misses = 0;
    } catch {
      misses += 1;
      if (misses >= 5) return { ok: false, error: LOCAL_SERVER_UNREACHABLE_ERROR };
      continue;
    }

    if (job.status === "error") {
      return { ok: false, error: job.error || "The local Whisper server failed to transcribe." };
    }
    if (job.status !== "done") continue;

    const segments: TranscriptSegment[] = (job.segments ?? [])
      .map((s) => ({
        start: Number(s.start ?? 0),
        end: Number(s.end ?? 0),
        text: (s.text ?? "").trim(),
      }))
      .filter((s) => s.text.length > 0);

    const words: TranscriptWord[] = (job.words ?? [])
      .map((w) => ({
        start: Number(w.start ?? 0),
        end: Number(w.end ?? 0),
        text: (w.word ?? "").trim(),
      }))
      .filter((w) => w.text.length > 0 && Number.isFinite(w.start) && Number.isFinite(w.end));

    const text = (job.text ?? "").trim() || segments.map((s) => s.text).join(" ").trim();
    if (!text) return { ok: false, error: "The transcription came back empty." };

    // Captions that don't share a clock with the audio are worse than none:
    // they read as correct and are wrong by an amount that grows. Refuse them
    // here rather than cache them for everyone.
    if (!timelineCoversAudio(segments, job.duration)) {
      console.error(
        `Local Whisper returned a compressed timeline: captions end at ` +
          `${transcriptEnd(segments).toFixed(0)}s for ${job.duration?.toFixed(0)}s of audio.`,
      );
      return { ok: false, error: COMPRESSED_TIMELINE_ERROR };
    }

    // One "chunk" covering the whole episode: this reuses mergeSegments purely
    // to attach each word to the line it falls inside, which is what the
    // caption fill reads. There is nothing to offset — a single chunk starts
    // at zero — so the timings pass through untouched.
    return {
      ok: true,
      text,
      segments: mergeSegments([{ segments, words }]),
      model: `${config.provider}/${config.model}`,
      // The server decoded the whole file, so this is the real thing rather
      // than a sum of measurements — and it is already checked for sanity by
      // `timelineCoversAudio` above.
      audioSeconds:
        typeof job.duration === "number" && job.duration > 0 ? job.duration : null,
    };
  }
}

/** End of the last caption, or 0 when there are none. */
function transcriptEnd(segments: TranscriptSegment[]): number {
  return segments.reduce((max, s) => Math.max(max, s.end), 0);
}

/**
 * Whether the timings plausibly run on the same clock as the audio.
 *
 * Permissive when it has nothing to compare against: a server that doesn't
 * report a duration gets the benefit of the doubt rather than having every
 * transcript refused.
 */
export function timelineCoversAudio(
  segments: TranscriptSegment[],
  audioDuration: number | undefined,
): boolean {
  if (!Number.isFinite(audioDuration) || (audioDuration ?? 0) <= 0) return true;
  if (segments.length === 0) return true;
  return transcriptEnd(segments) >= (audioDuration as number) * MIN_TIMELINE_COVERAGE;
}

/** Fetches JSON with a timeout. Throws on transport or status failure. */
async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const combined = mergeSignals(signal, controller.signal);

  try {
    const response = await fetch(url, { ...init, signal: combined });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** True when this result came from a locally-run model rather than a paid API. */
export function servedLocally(result: TranscriptionResult): boolean {
  return result.ok && result.model.startsWith("colab/");
}

/** Whether a local Whisper server is up and accepting requests right now. */
async function isReachable(
  baseUrl: string,
  sharedSecret: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COLAB_HEALTH_TIMEOUT_MS);
  const combined = mergeSignals(signal, controller.signal);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      headers: sharedSecret ? { authorization: `Bearer ${sharedSecret}` } : {},
      signal: combined,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** The simple path: one download, one transcription. */
async function transcribeWhole(
  audioUrl: string,
  config: SttConfig,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  let audio: Blob;
  try {
    const response = await fetch(audioUrl, { headers: publisherHeaders(), signal });
    if (!response.ok) return { ok: false, error: "Couldn't download the episode audio." };
    audio = await response.blob();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Transcription timed out." };
    }
    return { ok: false, error: "Couldn't download the episode audio." };
  }

  if (audio.size > (config.maxUploadBytes ?? PROVIDER_MAX_BYTES)) {
    // Content-length lied (or was absent) and the real file is over the cap.
    return { ok: false, error: TOO_LONG_ERROR };
  }

  const result = await transcribeBlob(audio, config, signal);
  if (!result.ok) return result;
  if (!result.text) return { ok: false, error: "The transcription came back empty." };

  /*
   * Measured off the bytes we just sent, which is the same thing the chunked
   * paths record. Null for anything that isn't MP3 — `measureFrames` finds no
   * frames and says so — which is the correct answer rather than a guess.
   *
   * Worth the read even though this path never had a re-stitching problem: the
   * value is what lets the player notice later that the served file has moved
   * on, and short episodes are no more immune to that than long ones.
   */
  const measured = measureFrames(new Uint8Array(await audio.arrayBuffer()));

  return {
    ok: true,
    text: result.text,
    audioSeconds: measured.framesCounted > 0 ? measured.seconds : null,
    // Through `mergeSegments` as a single chunk, the same as the local path.
    // It was returning the provider's segments raw, which meant an episode
    // small enough to send in one request — the simplest case there is — was
    // the one case that got no per-word timings at all, and so the one case
    // where the caption fill swept whole lines instead of following the voice.
    // There is nothing to offset with one chunk; this is for the word grouping
    // and the loop cleanup.
    segments: mergeSegments([{ segments: result.segments, words: result.words }]),
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
  makeChunk: (index: number, signal?: AbortSignal) => Promise<PreparedChunk>,
  config: SttConfig,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const results = new Array<ChunkResult | null>(count).fill(null);

  let nextIndex = 0;
  let failure: string | null = null;
  const deadline = Date.now() + (config.jobDeadlineMs ?? JOB_DEADLINE_MS);

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
        const chunk = await makeChunk(index, signal);
        const transcribed = await transcribeBlob(chunk.blob, config, signal);
        if (!transcribed.ok) {
          failure ??= transcribed.error;
          return;
        }
        results[index] = {
          segments: transcribed.segments,
          words: transcribed.words,
          seconds: chunk.seconds,
        };
      } catch (err) {
        if (err instanceof RenditionChangedError) {
          /*
           * Not retried here. By the time this surfaces most of the 48s budget
           * is spent, and a restart would re-download everything only to race
           * the same stitcher again. Failing with an error that says what
           * happened lets the listener retry against a settled CDN copy, which
           * is the thing that actually works.
           */
          console.error(`Audio re-stitched mid-job: ${err.message}`);
          failure ??= RESTITCHED_ERROR;
        } else if (err instanceof Error && err.name === "AbortError") {
          failure ??= "Transcription timed out.";
        } else {
          failure ??= "Couldn't download part of the episode audio.";
        }
        return;
      }
    }
  }

  const concurrency = Math.max(1, config.concurrency ?? TRANSCRIBE_CONCURRENCY);
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));

  if (failure) return { ok: false, error: failure };

  const chunks = results.filter((r): r is ChunkResult => r !== null);
  if (chunks.length !== count) {
    return { ok: false, error: "Transcription failed. Please try again." };
  }

  const segments = mergeSegments(chunks);
  const text = segments.map((s) => s.text).join(" ").trim();
  if (!text) return { ok: false, error: "The transcription came back empty." };

  return {
    ok: true,
    text,
    segments,
    model: `${config.provider}/${config.model}`,
    audioSeconds: measuredSeconds(chunks),
  };
}

/**
 * Total length of the audio these chunks were measured from.
 *
 * Null unless *every* chunk was measured off its container. A partial sum would
 * be a smaller number than the real duration while looking like a real one, and
 * this is stored to answer "is the file the listener is streaming still the file
 * this was timed against?" — a question a silently short answer gets wrong in
 * the direction that matters.
 */
function measuredSeconds(chunks: ChunkResult[]): number | null {
  let total = 0;
  for (const chunk of chunks) {
    if (typeof chunk.seconds !== "number" || chunk.seconds <= 0) return null;
    total += chunk.seconds;
  }
  return total > 0 ? total : null;
}

/** MP3: every byte range is already playable once trimmed to a frame boundary. */
async function transcribeMp3Chunked(
  rendition: Rendition,
  config: SttConfig,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const ranges = planChunks(
    rendition.total,
    config.chunkTargetBytes ?? CHUNK_TARGET_BYTES,
  );

  return transcribeChunks(
    ranges.length,
    (index, sig) => {
      const { start, end } = ranges[index];
      return fetchChunk(rendition, start, end, index === 0, sig);
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
  rendition: Rendition,
  config: SttConfig,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const moov = await locateMoov(rendition, signal);
  if (!moov) return { ok: false, error: MP4_UNREADABLE_ERROR };

  const track = parseAudioTrack(moov);
  if (!track) return { ok: false, error: MP4_UNREADABLE_ERROR };

  const groups = planSampleGroups(
    track.samples,
    config.chunkTargetBytes ?? CHUNK_TARGET_BYTES,
  );
  if (groups.length === 0) return { ok: false, error: MP4_UNREADABLE_ERROR };

  return transcribeChunks(
    groups.length,
    (index, sig) => buildMp4Chunk(rendition, track, groups[index], sig),
    config,
    signal,
  );
}

/** Fetches one group's audio frames and wraps them in a playable M4A. */
async function buildMp4Chunk(
  rendition: Rendition,
  track: Mp4AudioTrack,
  group: { start: number; end: number },
  signal?: AbortSignal,
): Promise<PreparedChunk> {
  const range = sampleRange(track.samples, group.start, group.end);
  const data = await fetchRange(rendition, range.start, range.end, CHUNK_FETCH_TIMEOUT_MS, signal);

  const samples = track.samples.slice(group.start, group.end);
  const file = buildM4A(track, samples, data, range.start);

  return {
    blob: new Blob([file.slice().buffer], { type: "audio/mp4" }),
    // Exact, unlike the MP3 side: a group is a whole number of samples and each
    // one declares its own duration, so nothing is left over at the boundary.
    seconds: groupSeconds(track, group),
  };
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
  rendition: Rendition,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const { total } = rendition;
  let cursor = 0;

  for (let hop = 0; hop < MOOV_SCAN_HOPS && cursor < total; hop += 1) {
    let window: Uint8Array;
    try {
      window = await fetchRange(
        rendition,
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
          rendition,
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

/**
 * Thrown when a range came back from a different cut of the episode than the one
 * the job was planned against. Distinct from a transport failure because it is
 * not retryable within this job — see `RESTITCHED_ERROR`.
 */
class RenditionChangedError extends Error {}

const RESTITCHED_ERROR =
  "This episode's host re-cut the file with different adverts while it was being transcribed, so the captions would not have lined up. Try again — it usually settles on one version.";

/**
 * Fetches a byte range of a pinned rendition. Throws on transport or status
 * failure, or if the host served a different cut than the one planned against.
 */
async function fetchRange(
  rendition: Rendition,
  start: number,
  end: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const combined = mergeSignals(signal, controller.signal);

  try {
    const response = await fetch(rendition.url, {
      // `end` is exclusive here but inclusive in an HTTP range header.
      headers: publisherHeaders({ range: `bytes=${start}-${end - 1}` }),
      signal: combined,
    });
    if (!response.ok) throw new Error(`range fetch failed: ${response.status}`);

    /*
     * Checked on the response we already have rather than asked for up front
     * with `If-Range`. That header looks like the right tool and is a trap here:
     * when the validator no longer matches, the server answers 200 with the
     * *entire* file — which on a 200MB episode, inside a 60s function, is a far
     * worse outcome than the mismatch it was meant to catch.
     */
    const mismatch = renditionMismatch(rendition, response.headers);
    if (mismatch?.fatal) {
      throw new RenditionChangedError(mismatch.detail);
    }
    if (mismatch) {
      console.warn(`Rendition validator moved but length held: ${mismatch.detail}`);
    }

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
