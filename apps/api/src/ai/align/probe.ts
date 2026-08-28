/**
 * Reading thirty seconds out of the middle of an episode we never downloaded.
 *
 * This is what makes correcting a transcript affordable. Transcribing an
 * episode to find out where its ads are costs the whole episode — fifty minutes
 * of Whisper and fifty megabytes — to answer a question that a few short
 * samples settle. A probe is one ranged read and one small upload, and four or
 * five of them locate every insertion in the file.
 *
 * **The arithmetic that makes it possible.** Ad stitching splices pre-encoded
 * frames into a stream, which requires every segment to share one frame
 * geometry, which in practice means the whole file is constant bitrate. On a CBR
 * file a byte offset *is* a timestamp: `(offset - audioStart) / bytesPerSecond`.
 * So a window of audio at any chosen moment can be requested directly, with no
 * index, no seeking and no prior download. `detect.ts` establishes the bitrate
 * and refuses when it is not constant, which is also the refusal for this.
 *
 * **Cut on frame edges, always.** A probe is uploaded to Whisper as a standalone
 * MP3, so it has to begin at a frame header and end at one. Starting mid-frame
 * produces a file that decodes to a burst of noise before the audio starts —
 * which Whisper cheerfully transcribes as words that are not in the episode, and
 * those words then fail to match anything. The byte offset from the arithmetic
 * is therefore a starting point for the search, not the answer: the real start
 * is the first confirmed frame at or after it, and the reported time is
 * recomputed from where that frame actually landed.
 */

import { fetchAudioRange, type AudioError } from '../audio.ts';
import { readFrameHeader } from '../mp3.ts';
import { findFrame, type AudioShape } from './detect.ts';
import { normalize, type Token } from './anchor.ts';
import type { TranscribedSegment } from '../groq.ts';

/**
 * Slack fetched past the window, so the last frame can be completed.
 *
 * A frame is at most 1,044 bytes (320kbps at 44.1kHz) and the search for the
 * first one may consume a few hundred more, so this is comfortable rather than
 * tight. It is a rounding error against a window of half a megabyte.
 */
const SLACK_BYTES = 8 * 1024;

export type Probe = {
  /** Where this window begins in the served audio. */
  startMs: number;
  /** How much audio it actually holds, summed from its frames. */
  durationMs: number;
  /** A standalone, frame-aligned MP3. */
  bytes: Uint8Array;
};

/** Byte offset of a moment in the served audio. Exact, on a CBR file. */
export function byteAt(shape: AudioShape, ms: number): number {
  return shape.audioStart + Math.round((ms / 1000) * shape.bytesPerSecond);
}

/** The inverse, for reporting where a frame that was found actually sits. */
export function msAt(shape: AudioShape, byte: number): number {
  return Math.round(((byte - shape.audioStart) / shape.bytesPerSecond) * 1000);
}

/**
 * Walk whole frames from `from` until `targetMs` of audio has been covered.
 *
 * Returns the end index and the duration actually accumulated, which is the
 * honest figure — frames do not divide evenly into any round number of
 * milliseconds, and the caller reports what it got rather than what it asked
 * for.
 */
function carve(
  bytes: Uint8Array,
  from: number,
  targetMs: number,
): { end: number; durationMs: number } {
  let at = from;
  let durationMs = 0;

  for (;;) {
    const frame = readFrameHeader(bytes, at);
    if (!frame || at + frame.length > bytes.length) break;

    at += frame.length;
    durationMs += frame.durationMs;

    if (durationMs >= targetMs) break;
  }

  return { end: at, durationMs: Math.round(durationMs) };
}

/**
 * Pull one window of audio, frame-aligned, without downloading the episode.
 *
 * Null rather than an error when the window cannot be carved — a probe landing
 * past the end of the file, or on bytes that hold no recognisable frame, is an
 * ordinary outcome of guessing where to look and the caller simply tries
 * somewhere else.
 */
export async function fetchProbe(
  url: string,
  shape: AudioShape,
  atMs: number,
  windowMs: number,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<Probe | AudioError | null> {
  if (!shape.constantBitrate) return null;

  const from = Math.max(shape.audioStart, byteAt(shape, atMs));
  const want = Math.round((windowMs / 1000) * shape.bytesPerSecond) + SLACK_BYTES;
  const to = Math.min(shape.totalBytes - 1, from + want);

  if (to <= from) return null;

  const range = await fetchAudioRange(url, from, to, options);
  if (range.status === 'error') return range;
  if (!range.ranged) return null;

  const first = findFrame(range.bytes);
  if (!first) return null;

  const { end, durationMs } = carve(range.bytes, first.offset, windowMs);
  if (durationMs <= 0 || end <= first.offset) return null;

  return {
    // Recomputed from where the frame really is, not from what was asked for.
    startMs: msAt(shape, from + first.offset),
    durationMs,
    bytes: range.bytes.subarray(first.offset, end),
  };
}

/**
 * Turn what Whisper heard into timed tokens on the episode's own clock.
 *
 * Word timings are used when Whisper supplied them and interpolated across the
 * segment when it did not, which is the same bargain `referenceTokens` makes on
 * the other side and is sound for the same reason: these feed a median over
 * dozens of matched pairs, not a highlight under anyone's eye.
 *
 * `probeStartMs` is added to everything, because Whisper timed the upload it was
 * given and that upload began partway into the episode.
 */
export function hypothesisTokens(
  segments: readonly TranscribedSegment[],
  probeStartMs: number,
): Token[] {
  const tokens: Token[] = [];

  for (const segment of segments) {
    if (segment.words && segment.words.length > 0) {
      for (const word of segment.words) {
        for (const text of normalize(word.text)) {
          tokens.push({ text, ms: probeStartMs + word.startMs });
        }
      }
      continue;
    }

    const words = normalize(segment.text);
    if (words.length === 0) continue;

    const span = Math.max(0, segment.endMs - segment.startMs);
    for (let i = 0; i < words.length; i += 1) {
      tokens.push({
        text: words[i]!,
        ms: probeStartMs + Math.round(segment.startMs + (span * i) / words.length),
      });
    }
  }

  return tokens;
}
