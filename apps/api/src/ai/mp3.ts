/**
 * Splitting an MP3 into pieces a transcription API will accept.
 *
 * Groq caps uploads at 25 MB on the free tier. Podcast episodes routinely run
 * 50–100 MB, so an hour-long show cannot be sent whole — and since this project
 * does not ship FFmpeg (it stores no audio and transcodes nothing), the split
 * has to happen here, in pure TypeScript, on bytes we never keep.
 *
 * That turns out to be tractable because MP3 is a **stream of self-delimiting
 * frames**: each carries a header describing its own length and duration, so
 * cutting on a frame boundary yields files that are themselves valid MP3. No
 * decoding, no re-encoding, no container to rewrite.
 *
 * The one imprecision is the *bit reservoir* — Layer III lets a frame borrow up
 * to 511 bytes of headroom from its predecessors, so the first frame or two
 * after a cut can decode with slightly wrong high frequencies. At 26ms per
 * frame that is a fraction of one syllable at each seam, against a transcript
 * measured in minutes. Re-encoding to avoid it would cost an FFmpeg dependency
 * and a full decode pass, which is not a trade worth making for this.
 */

/** MPEG version, from the two version bits. Index 1 is reserved and invalid. */
const VERSION_MPEG25 = 0;
const VERSION_MPEG2 = 2;
const VERSION_MPEG1 = 3;

/** Layer III, the only layer podcast audio uses. */
const LAYER_III = 1;

/** kbps by bitrate index. Index 0 is "free" and 15 is "bad"; both are unusable. */
const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

const SAMPLE_RATES: Record<number, readonly number[]> = {
  [VERSION_MPEG1]: [44100, 48000, 32000, 0],
  [VERSION_MPEG2]: [22050, 24000, 16000, 0],
  [VERSION_MPEG25]: [11025, 12000, 8000, 0],
};

export type Mp3Frame = {
  /** Byte offset of the frame header within the source. */
  offset: number;
  length: number;
  durationMs: number;
};

/**
 * Read the frame header at `offset`, or null if there is not a valid one there.
 *
 * "Valid" is stricter than the sync word alone, because 11 set bits occur
 * constantly inside compressed audio and inside ID3 artwork. Checking the
 * version, layer, bitrate and sample rate as well is what makes a false sync
 * rare enough to recover from by scanning forward.
 */
export function readFrameHeader(bytes: Uint8Array, offset: number): Mp3Frame | null {
  if (offset + 4 > bytes.length) return null;

  const b0 = bytes[offset]!;
  const b1 = bytes[offset + 1]!;
  const b2 = bytes[offset + 2]!;

  // Eleven sync bits.
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const version = (b1 >> 3) & 0x03;
  const layer = (b1 >> 1) & 0x03;

  if (version === 1 || layer !== LAYER_III) return null;

  const bitrateIndex = (b2 >> 4) & 0x0f;
  const rateIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;

  const isVersion1 = version === VERSION_MPEG1;
  const kbps = (isVersion1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex]!;
  const sampleRate = SAMPLE_RATES[version]![rateIndex]!;

  // A "free" or "bad" bitrate, or a reserved sample rate. Real files do not
  // contain these, so this is a false sync rather than an exotic frame.
  if (kbps === 0 || sampleRate === 0) return null;

  // MPEG-1 Layer III packs 1152 samples per frame, MPEG-2/2.5 packs 576 — which
  // is exactly why the length coefficient halves along with it.
  const samplesPerFrame = isVersion1 ? 1152 : 576;
  const coefficient = isVersion1 ? 144 : 72;

  const length = Math.floor((coefficient * kbps * 1000) / sampleRate) + padding;

  // Shorter than its own header means the arithmetic met a corrupt byte.
  if (length < 4) return null;

  return { offset, length, durationMs: (samplesPerFrame / sampleRate) * 1000 };
}

/**
 * Where the audio starts, past any ID3v2 tag.
 *
 * Podcast files carry large ones — cover art is routinely hundreds of
 * kilobytes — and that payload is arbitrary bytes that will contain false sync
 * words. Skipping the tag by its declared length is far more reliable than
 * hunting for the first frame inside it.
 */
export function audioStart(bytes: Uint8Array): number {
  if (bytes.length < 10) return 0;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0; // 'ID3'

  /**
   * Synchsafe integer: seven bits per byte, high bit always clear, so the size
   * field can never itself contain a sync word. Reading it as a plain
   * big-endian number is a classic bug that lands you mid-tag.
   */
  const size =
    ((bytes[6]! & 0x7f) << 21) |
    ((bytes[7]! & 0x7f) << 14) |
    ((bytes[8]! & 0x7f) << 7) |
    (bytes[9]! & 0x7f);

  const footer = (bytes[5]! & 0x10) !== 0 ? 10 : 0;

  return Math.min(bytes.length, 10 + size + footer);
}

/**
 * Walk every frame in the file.
 *
 * On a bad header the scan advances one byte and tries again rather than giving
 * up. Podcast MP3s are concatenated from multiple encoders, carry mid-file tags,
 * and are occasionally truncated by a bad upload — abandoning the file at the
 * first surprise would lose the other fifty-nine minutes.
 */
export function* frames(bytes: Uint8Array): Generator<Mp3Frame> {
  let offset = audioStart(bytes);

  while (offset + 4 <= bytes.length) {
    const frame = readFrameHeader(bytes, offset);

    if (!frame) {
      offset += 1;
      continue;
    }

    yield frame;
    offset += frame.length;
  }
}

export type Mp3Chunk = {
  bytes: Uint8Array;
  /** Offset of this chunk within the episode, for shifting the returned cues. */
  startMs: number;
  durationMs: number;
};

/**
 * Split into chunks no larger than `maxBytes`, cutting only on frame edges.
 *
 * Returns an empty array when the input holds no recognisable frames, which is
 * the signal that this is not an MP3 at all — the caller decides what to do
 * about that rather than being handed a plausible-looking single chunk of
 * something else.
 */
export function chunkMp3(bytes: Uint8Array, maxBytes: number): Mp3Chunk[] {
  const chunks: Mp3Chunk[] = [];

  let start = -1;
  let end = -1;
  let chunkStartMs = 0;
  let elapsedMs = 0;

  /**
   * Boundaries are rounded; durations are derived from them.
   *
   * A frame lasts 26.122ms, so rounding each chunk's offset and its length
   * independently lets the two drift apart — chunk *n* would claim to end a
   * millisecond before chunk *n+1* says it begins. Since these offsets are what
   * shift the transcriber's cues back into episode time, deriving the duration
   * from the two rounded edges makes the chunks tile exactly, by construction
   * rather than by luck.
   */
  const flush = () => {
    if (start < 0) return;

    const startMs = Math.round(chunkStartMs);

    chunks.push({
      bytes: bytes.subarray(start, end),
      startMs,
      durationMs: Math.round(elapsedMs) - startMs,
    });

    start = -1;
  };

  for (const frame of frames(bytes)) {
    // A single frame larger than the budget cannot be split further; it goes
    // out alone and oversized rather than being dropped, and the caller's
    // upload is what refuses it. Silently discarding audio would produce a
    // transcript with an unexplained hole.
    if (start >= 0 && end - start + frame.length > maxBytes) flush();

    if (start < 0) {
      start = frame.offset;
      chunkStartMs = elapsedMs;
    }

    end = frame.offset + frame.length;
    elapsedMs += frame.durationMs;
  }

  flush();

  return chunks;
}

/** Total playing time, used to size a job before committing to it. */
export function durationMs(bytes: Uint8Array): number {
  let total = 0;
  for (const frame of frames(bytes)) total += frame.durationMs;
  return Math.round(total);
}
