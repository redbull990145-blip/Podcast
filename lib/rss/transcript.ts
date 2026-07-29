import type { TranscriptSegment } from "@/lib/db/schema";
import { assertSafeFeedUrl } from "./url-guard";

/**
 * Publisher-supplied transcripts, referenced by <podcast:transcript>.
 *
 * These are strictly better than anything we could generate: they are free, they
 * are instant, and they are usually human-corrected. So captions always look for
 * one of these before offering to spend AI quota on transcribing the audio.
 *
 * Three formats are common in the wild — WebVTT, SRT, and Podcasting 2.0's JSON
 * — and all three are small enough to parse by hand.
 */

const FETCH_TIMEOUT_MS = 8_000;

/** Transcripts are text; a multi-megabyte one is a misconfiguration, not content. */
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;

const USER_AGENT = "Cadence/1.0 (+https://github.com/redbull990145-blip/Podcast)";

/**
 * "00:01:02.500" / "01:02,500" / "62.5" -> seconds.
 *
 * VTT allows the hours field to be dropped and uses a dot before milliseconds;
 * SRT always has hours and uses a comma. Accepting both here is cheaper than
 * branching on format at every call site.
 */
export function parseTimestamp(raw: string): number | null {
  const cleaned = raw.trim().replace(",", ".");
  if (!cleaned) return null;

  const parts = cleaned.split(":");
  if (parts.length > 3) return null;

  let seconds = 0;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value) || value < 0) return null;
    seconds = seconds * 60 + value;
  }

  return Number.isFinite(seconds) ? seconds : null;
}

/** Drops VTT inline markup (<v Speaker>, <c.classname>, <00:00:01.000>). */
function stripCueMarkup(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses WebVTT and SRT, which differ only in a header line and their decimal
 * separator — both are "optional cue id / timing line / text / blank line".
 */
export function parseCueFormat(body: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  // Normalise line endings first: SRT files from Windows tooling are CRLF, and
  // a stray \r otherwise ends up inside the caption text.
  const blocks = body.replace(/\r\n?/g, "\n").replace(/^WEBVTT[^\n]*\n/, "").split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;

    const timingIndex = lines.findIndex((l) => l.includes("-->"));
    if (timingIndex === -1) continue;

    // Cue settings (align, line, position) trail the end timestamp; split on
    // whitespace so they never get parsed as part of the time.
    const [rawStart, rest] = lines[timingIndex].split("-->");
    const rawEnd = rest?.trim().split(/\s+/)[0] ?? "";

    const start = parseTimestamp(rawStart ?? "");
    const end = parseTimestamp(rawEnd);
    if (start == null || end == null) continue;

    const text = stripCueMarkup(lines.slice(timingIndex + 1).join(" "));
    if (!text) continue;

    segments.push({ start, end: Math.max(end, start), text });
  }

  return segments;
}

/** Podcasting 2.0's JSON transcript: `{ segments: [{ startTime, endTime, body }] }`. */
export function parseJsonTranscript(raw: string): TranscriptSegment[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }

  const list = (data as { segments?: unknown })?.segments;
  if (!Array.isArray(list)) return [];

  const segments: TranscriptSegment[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    const start = Number(obj.startTime ?? obj.start);
    const end = Number(obj.endTime ?? obj.end);
    const text =
      typeof obj.body === "string"
        ? obj.body
        : typeof obj.text === "string"
          ? obj.text
          : "";

    if (!Number.isFinite(start) || !text.trim()) continue;

    segments.push({
      start,
      end: Number.isFinite(end) ? Math.max(end, start) : start,
      text: text.trim(),
    });
  }

  return segments;
}

/**
 * Merges the very short cues that VTT files are usually cut into.
 *
 * Broadcast captions are chopped into two-second fragments to fit a TV safe
 * area. Read on screen while listening, that scrolls too fast to follow, so
 * neighbouring cues are joined up to a readable sentence-sized line.
 */
function coalesce(segments: TranscriptSegment[]): TranscriptSegment[] {
  const MIN_CHARS = 60;
  const MAX_GAP_SECONDS = 2;

  const out: TranscriptSegment[] = [];

  for (const segment of segments) {
    const previous = out[out.length - 1];
    const joinable =
      previous &&
      previous.text.length < MIN_CHARS &&
      segment.start - previous.end <= MAX_GAP_SECONDS &&
      // Never merge across a sentence boundary — that is exactly where a reader
      // wants the line to break.
      !/[.!?]["')\]]?$/.test(previous.text);

    if (joinable) {
      previous.text = `${previous.text} ${segment.text}`;
      previous.end = segment.end;
    } else {
      out.push({ ...segment });
    }
  }

  return out;
}

export type FetchedTranscript = {
  segments: TranscriptSegment[];
  text: string;
};

/**
 * Downloads and parses a publisher transcript.
 *
 * Returns null rather than throwing on any failure — a missing transcript
 * disables captions, it does not break the episode.
 */
export async function fetchTranscript(url: string): Promise<FetchedTranscript | null> {
  let safe: URL;
  try {
    safe = assertSafeFeedUrl(url);
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(safe, {
      headers: { "user-agent": USER_AGENT, accept: "text/vtt, application/json, text/*" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) return null;

    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_TRANSCRIPT_BYTES) return null;

    const body = await response.text();
    if (body.length > MAX_TRANSCRIPT_BYTES) return null;

    // Sniff the content rather than trusting the extension or content-type:
    // plenty of hosts serve .vtt as text/plain and .json as octet-stream.
    const trimmed = body.trimStart();
    const parsed = trimmed.startsWith("{")
      ? parseJsonTranscript(body)
      : parseCueFormat(body);

    if (parsed.length === 0) return null;

    const segments = coalesce(parsed);
    return { segments, text: segments.map((s) => s.text).join(" ") };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
