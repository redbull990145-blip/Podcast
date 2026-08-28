/**
 * Whether a publisher's transcript is describing the audio we are actually served.
 *
 * The failure this exists to catch is not a bug in the cue timings. Podcast
 * enclosures are stitched per request — an ad server splices pre-encoded
 * segments into the master before sending it — and the publisher's caption file
 * was timed against the master, before any of that happened. The cues are right;
 * they are right about a shorter file. Measured on *Elevation with Steven
 * Furtick*, the feed declares 48,181,533 bytes and the CDN serves 48,320,613:
 * 139,080 bytes of inserted audio, which at that file's 128kbps is 8.7 seconds
 * that every cue after the insertion point is out by.
 *
 * **This costs no transcription and almost no bandwidth.** Three ranged reads of
 * a few hundred bytes each are enough, because an MP3's own header says how many
 * bytes it spends per second: ten bytes at the front give the ID3v2 tag length,
 * a couple of kilobytes at the first frame give the bitrate, and `Content-Range`
 * gives the true size of a file we never download. The arithmetic does the rest.
 *
 * The measurement is only sound for constant-bitrate audio — which is what ad
 * stitching produces and requires, since splicing pre-encoded frames into a
 * stream means every segment agreeing on frame geometry. A variable-bitrate file
 * gets `constantBitrate: false` and no duration claim, because for those bytes
 * and seconds are not proportional and any number here would be invented.
 */

import { readFrameHeader, tagEndFromHeader, type Mp3Frame } from '../mp3.ts';
import { fetchAudioRange, type AudioError } from '../audio.ts';

/**
 * How much to read when hunting for a frame header.
 *
 * A frame at 128kbps is 417 bytes, so this holds several — enough for the
 * two-frame agreement test below to have something to agree with, and enough to
 * skip whatever padding a stitcher left between segments.
 */
const SCAN_BYTES = 2048;

/**
 * How much of the front of the file to take in the opening read.
 *
 * Sized to answer two questions in one round trip rather than two. The first ten
 * bytes give the ID3v2 tag length and the `Content-Range` gives the file size,
 * but the bitrate lives at the *end* of that tag — so reading only the header
 * means a second request to a CDN that has already cost a redirect walk through
 * a tracking prefix. 64KB covers the tag on most podcast files (the measured
 * Elevation episode's is 49,157 bytes) and is small enough to be free. Files with
 * larger cover art fall back to the second read, which is why that path still
 * exists.
 */
const HEAD_BYTES = 64 * 1024;

export type AudioShape = {
  status: 'ok';
  /** Size of the file the CDN would actually send a listener. */
  totalBytes: number;
  /** First byte of audio, past the ID3v2 tag and any padding after it. */
  audioStart: number;
  kbps: number;
  sampleRate: number;
  bytesPerSecond: number;
  /**
   * Whether the frame geometry held at both ends of the file.
   *
   * False also covers "could not check" — a publisher that ignored the range
   * request, or a file too short to have two distinct ends. Callers must read it
   * as "not safe to do byte arithmetic on", never as "proven variable".
   */
  constantBitrate: boolean;
  /** Playing time of the served file. Null unless the bitrate is trustworthy. */
  durationMs: number | null;
};

export type ShapeOutcome =
  | AudioShape
  | AudioError
  /** Reached it, read it, and it is not an MP3 this can measure. */
  | { status: 'unreadable'; detail: string };

/**
 * The first frame at or after `from`, confirmed by the one that follows it.
 *
 * Eleven set bits occur constantly inside compressed audio, so `readFrameHeader`
 * on its own accepts a false sync every few kilobytes. Requiring the next header
 * to land exactly where this frame's length says it will is what makes a mid-file
 * probe reliable — two false syncs in a row at precisely the right distance is
 * rare enough to ignore. When the buffer runs out before the second frame could
 * begin the first is accepted alone; refusing there would fail on a probe that
 * merely landed near the end of the file.
 */
export function findFrame(bytes: Uint8Array, from = 0): Mp3Frame | null {
  for (let i = from; i + 4 <= bytes.length; i += 1) {
    const first = readFrameHeader(bytes, i);
    if (!first) continue;

    const nextAt = i + first.length;
    if (nextAt + 4 > bytes.length) return first;
    if (readFrameHeader(bytes, nextAt)) return first;
  }

  return null;
}

/** Bytes one second of audio occupies at this bitrate. 128kbps is 16,000. */
export function bytesPerSecondAt(kbps: number): number {
  return (kbps * 1000) / 8;
}

/**
 * Measure the file a listener would be served, without downloading it.
 */
export async function readAudioShape(
  url: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ShapeOutcome> {
  const head = await fetchAudioRange(url, 0, HEAD_BYTES - 1, options);
  if (head.status === 'error') return head;

  const tagEnd = tagEndFromHeader(head.bytes);
  if (tagEnd === null) return { status: 'unreadable', detail: 'The file is too short to read' };

  if (head.totalBytes === null || head.totalBytes <= tagEnd) {
    return { status: 'unreadable', detail: 'The publisher would not report the file size' };
  }

  const totalBytes = head.totalBytes;

  /**
   * Usually the first read already contains the first frame, and this is free.
   * A second request is only for the minority of files whose cover art runs past
   * `HEAD_BYTES`.
   */
  let scanFrom = tagEnd;
  let scan = head.bytes;

  if (tagEnd + 4 > head.bytes.length) {
    const rest = await fetchAudioRange(url, tagEnd, tagEnd + SCAN_BYTES - 1, options);
    if (rest.status === 'error') return rest;
    if (!rest.ranged) {
      return { status: 'unreadable', detail: 'The publisher would not serve the audio start' };
    }
    scanFrom = 0;
    scan = rest.bytes;
  }

  const frame = findFrame(scan, scanFrom);
  if (!frame) return { status: 'unreadable', detail: 'No MP3 frame where the audio should start' };

  const { kbps, sampleRate } = frame;
  const bytesPerSecond = bytesPerSecondAt(kbps);

  /**
   * Audio really begins at the frame that was found, which can sit a little past
   * the tag when a stitcher has left padding between segments.
   *
   * `frame.offset` is an index into `scan`, and `scan` is either the whole head
   * read (offsets are absolute) or a window starting at the tag (offsets are
   * relative to it), so the origin is recovered rather than assumed.
   */
  const audioStart = scanFrom === 0 ? tagEnd + frame.offset : frame.offset;

  /**
   * Confirm the geometry at the far end before trusting bytes-to-seconds.
   *
   * Only attempted when the earlier requests were honoured *as ranges*. On a
   * publisher that ignores `Range`, asking for the tail means streaming the whole
   * episode to reach it — which is precisely the cost this module exists to
   * avoid, and would turn a three-request check into a 48MB download.
   */
  let constantBitrate = false;
  if (head.ranged && totalBytes > audioStart + SCAN_BYTES * 4) {
    const tail = await fetchAudioRange(url, totalBytes - SCAN_BYTES, totalBytes - 1, options);

    if (tail.status === 'ok') {
      const tailFrame = findFrame(tail.bytes);
      if (tailFrame) {
        constantBitrate = tailFrame.kbps === kbps && tailFrame.sampleRate === sampleRate;
      }
    }
  }

  return {
    status: 'ok',
    totalBytes,
    audioStart,
    kbps,
    sampleRate,
    bytesPerSecond,
    constantBitrate,
    durationMs: constantBitrate
      ? Math.round(((totalBytes - audioStart) / bytesPerSecond) * 1000)
      : null,
  };
}

export type InsertedAudio = {
  /** Bytes the served file carries that the feed's declared length does not. */
  extraBytes: number;
  /** Those bytes as playing time. Negative if the served file is the shorter one. */
  insertedMs: number;
  /**
   * How long the audio the cues were timed against ran for.
   *
   * This, not the served duration, is what belongs in `transcripts.audioDurationMs`:
   * that column means "the length of the audio these cues describe", and the whole
   * point is that it differs from what the listener is playing. On the measured
   * Elevation episode it comes to 3,008,270ms against an `<itunes:duration>` of
   * 3008s — the arithmetic agreeing with the publisher to within a third of a
   * second, which is the check that this reading of `<enclosure length>` is right.
   */
  declaredDurationMs: number;
};

/**
 * Compare the served file against the length the feed declared for it.
 *
 * `declaredBytes` is the `<enclosure length>` attribute, which describes the
 * master: publishers write it once, at publication, and the ad server does not
 * revise it on the way past. That staleness is exactly what makes the
 * subtraction meaningful.
 *
 * Null when the comparison cannot be made honestly — no declared length, or a
 * bitrate that is not constant and so cannot convert bytes into seconds.
 */
export function insertedAudio(
  shape: AudioShape,
  declaredBytes: number | null | undefined,
): InsertedAudio | null {
  if (!declaredBytes || declaredBytes <= shape.audioStart) return null;
  if (!shape.constantBitrate) return null;

  const extraBytes = shape.totalBytes - declaredBytes;

  return {
    extraBytes,
    insertedMs: Math.round((extraBytes / shape.bytesPerSecond) * 1000),
    declaredDurationMs: Math.round(
      ((declaredBytes - shape.audioStart) / shape.bytesPerSecond) * 1000,
    ),
  };
}
