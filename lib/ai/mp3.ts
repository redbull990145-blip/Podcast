/**
 * Just enough MPEG audio parsing to cut a podcast into pieces safely.
 *
 * Splitting an MP3 on arbitrary byte boundaries mostly works — decoders resync
 * at the next frame header — with one important exception: the very first
 * chunk. The start of the file carries an ID3v2 tag and, for VBR encodes, a
 * Xing/Info header frame declaring the total frame count for the *whole*
 * episode. Truncate the file and that metadata is now a lie: it claims an hour
 * of audio in front of twenty minutes of frames.
 *
 * Whisper providers do not take that well. Groq spends two minutes on such a
 * file and then answers 502, and bills the declared duration rather than the
 * real one — so one truncated first chunk can consume an entire hour of the
 * free tier's audio-seconds allowance and still fail.
 *
 * Stripping the leading metadata leaves a bare sequence of frames, which is
 * exactly what a mid-file slice already looks like, and those transcribe
 * without complaint.
 */

/** Layer III bitrate tables, indexed by the 4-bit bitrate index. kbps. */
const BITRATES_MPEG1 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const BITRATES_MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

/** Sampling rates by version id (3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5). */
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

export type Mp3Frame = {
  offset: number;
  /** Total frame size in bytes, including the 4-byte header. */
  length: number;
  /** Output samples this frame decodes to: 1152 for MPEG1, 576 for MPEG2/2.5. */
  samples: number;
  sampleRate: number;
};

/**
 * Reads a Layer III frame header at `offset`.
 *
 * Returns null for anything that isn't a plausible frame, which is how the
 * scan below rejects the false sync words that turn up inside album art.
 */
export function parseFrameHeader(bytes: Uint8Array, offset: number): Mp3Frame | null {
  if (offset + 4 > bytes.length) return null;

  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];

  // 11-bit sync word.
  if (bytes[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const version = (b1 >> 3) & 0x03; // 1 is reserved
  const layer = (b1 >> 1) & 0x03; // 1 is Layer III
  if (version === 1 || layer !== 1) return null;

  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  // "free" and "bad" bitrates, and the reserved sample rate, mean this is not
  // a frame header we can size.
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) return null;

  const bitrate =
    (version === 3 ? BITRATES_MPEG1 : BITRATES_MPEG2)[bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version]?.[sampleIndex];
  if (!bitrate || !sampleRate) return null;

  // MPEG1 Layer III fits 1152 samples per frame, MPEG2/2.5 fit 576.
  const coefficient = version === 3 ? 144 : 72;
  const length = Math.floor((coefficient * bitrate) / sampleRate) + padding;
  if (length < 4) return null;

  // The coefficient is samples/8 — the same constant the length formula uses,
  // read the other way round.
  return { offset, length, samples: coefficient * 8, sampleRate };
}

/**
 * Total size of a leading ID3v2 tag, or 0 when there isn't one.
 *
 * The size field is "syncsafe": seven bits per byte, so the tag length can
 * never contain a byte that looks like a frame sync.
 */
export function id3v2Length(bytes: Uint8Array): number {
  if (bytes.length < 10) return 0;
  // "ID3"
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;

  const flags = bytes[5];
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);

  const footer = flags & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

/**
 * Finds the next real frame header at or after `from`.
 *
 * Candidate syncs are confirmed by checking that a second frame follows exactly
 * where the first one's length says it should. A single header can appear by
 * chance in binary data; two consecutive, consistent ones essentially cannot.
 */
export function findFrame(bytes: Uint8Array, from = 0, searchLimit = 256 * 1024): Mp3Frame | null {
  const end = Math.min(bytes.length - 4, from + searchLimit);

  for (let i = Math.max(0, from); i <= end; i += 1) {
    if (bytes[i] !== 0xff) continue;

    const frame = parseFrameHeader(bytes, i);
    if (!frame) continue;

    const next = frame.offset + frame.length;
    // Accept a frame at the very end of the buffer without a successor.
    if (next + 4 > bytes.length) return frame;
    if (parseFrameHeader(bytes, next)) return frame;
  }

  return null;
}

/** True when this frame is a Xing/Info/VBRI header rather than real audio. */
function isVbrHeaderFrame(bytes: Uint8Array, frame: Mp3Frame): boolean {
  const end = Math.min(frame.offset + frame.length, bytes.length);

  // The tag sits at a fixed offset that depends on version and channel mode.
  // Scanning the frame body instead covers every layout without branching on
  // either, and a false positive is impossible: these are the only places
  // those four ASCII bytes legitimately appear.
  for (let i = frame.offset + 4; i + 4 <= end; i += 1) {
    const a = bytes[i];
    if (a !== 0x58 && a !== 0x49 && a !== 0x56) continue; // X, I, V

    const tag = String.fromCharCode(a, bytes[i + 1], bytes[i + 2], bytes[i + 3]);
    if (tag === "Xing" || tag === "Info" || tag === "VBRI") return true;
  }

  return false;
}

/**
 * Byte offset of the first real audio frame, past any ID3v2 tag and VBR header.
 *
 * Returns 0 when nothing recognisable is found, so a file we cannot parse is
 * passed through untouched rather than mangled.
 */
export function audioStartOffset(bytes: Uint8Array): number {
  const afterTag = id3v2Length(bytes);

  const first = findFrame(bytes, afterTag);
  if (!first) return afterTag <= bytes.length ? afterTag : 0;

  if (!isVbrHeaderFrame(bytes, first)) return first.offset;

  // Drop the VBR header frame; the next frame is where the audio really starts.
  const second = findFrame(bytes, first.offset + first.length);
  return second ? second.offset : first.offset + first.length;
}

/**
 * How far to hunt for the next header after one fails to parse.
 *
 * Frames in a well-formed file are contiguous, so this only comes into play
 * around embedded junk — a stray tag, a splice point from the host's ad
 * stitcher. Bounded so a corrupt region degrades to "stop measuring here"
 * rather than scanning the rest of the chunk byte by byte.
 */
const RESYNC_LIMIT = 64 * 1024;

/**
 * Exact playback duration of a run of MP3 frames, in seconds.
 *
 * This is what a chunk's position on the episode timeline has to be built from.
 * The obvious alternative — asking Whisper where its last word landed — is only
 * the chunk's duration if the chunk happens to end on speech, and it never
 * does: every boundary falls somewhere in a music bed, a pause or an outro, and
 * that trailing time is silently lost. Because a boundary can only ever *lose*
 * time, the error is one-directional and accumulates, so captions run
 * progressively early and a three-hour episode ends up seconds out. See
 * plans/005-caption-sync-accuracy.md.
 *
 * Summing frame headers has none of that. Each header declares its own bitrate
 * and sample rate, so the answer is exact for VBR as well as CBR, and it needs
 * no decoding — just a header read and a skip.
 *
 * A frame cut in half by the end of the range is counted here in full, which is
 * what makes the sum across boundaries exact rather than merely close. The
 * frame's header is in this chunk, so this chunk is where it is counted; the
 * next chunk starts at the following header, because `prepareChunk` aligns to
 * the first *parseable* frame and the orphaned body fragment has no header of
 * its own to be found by. So every frame in the file is counted exactly once.
 *
 * Returns null when there are no parseable frames at all, so the caller can
 * fall back rather than place a chunk at zero.
 */
export function frameSeconds(bytes: Uint8Array): number | null {
  const first = parseFrameHeader(bytes, 0) ?? findFrame(bytes, 0);
  if (!first) return null;

  let offset = first.offset;
  let seconds = 0;
  let counted = 0;

  while (offset + 4 <= bytes.length) {
    const frame = parseFrameHeader(bytes, offset);

    if (!frame) {
      const next = findFrame(bytes, offset + 1, RESYNC_LIMIT);
      if (!next) break;
      offset = next.offset;
      continue;
    }

    seconds += frame.samples / frame.sampleRate;
    counted += 1;

    // Cut mid-frame. Counted above, because the header is here and the next
    // chunk cannot see the orphaned body — nothing else will count it.
    if (frame.offset + frame.length > bytes.length) break;

    offset += frame.length;
  }

  return counted > 0 ? seconds : null;
}

/**
 * Trims a chunk so it begins on a clean frame boundary.
 *
 * The first chunk additionally loses its ID3v2 tag and VBR header, which is the
 * whole point of this module. Later chunks only need aligning — they carry no
 * metadata, and dropping at most one partial frame costs under 30ms.
 */
export function prepareChunk(bytes: Uint8Array, isFirst: boolean): Uint8Array {
  if (isFirst) {
    const offset = audioStartOffset(bytes);
    return offset > 0 && offset < bytes.length ? bytes.subarray(offset) : bytes;
  }

  const frame = findFrame(bytes, 0);
  return frame && frame.offset > 0 && frame.offset < bytes.length
    ? bytes.subarray(frame.offset)
    : bytes;
}
