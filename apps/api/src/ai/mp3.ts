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
  /**
   * The declared bitrate and sample rate, carried rather than re-derivable.
   *
   * They cannot be recovered from `length` and `durationMs` afterwards, which is
   * the reason they are here. MPEG-1 at 44.1kHz and MPEG-2 at 22.05kHz produce
   * *identical* frame durations — 1152/44100 and 576/22050 are both 26.122ms —
   * so a caller working backwards from duration cannot tell which version it is
   * holding, and picks the wrong samples-per-frame half the time. Reading it off
   * the header, where it is unambiguous, is the only correct answer.
   */
  kbps: number;
  sampleRate: number;
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

  return { offset, length, durationMs: (samplesPerFrame / sampleRate) * 1000, kbps, sampleRate };
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
  const end = tagEndFromHeader(bytes);
  if (end === null) return 0;
  return Math.min(bytes.length, end);
}

/**
 * Where the ID3v2 tag ends, according to its own header, ignoring how much of
 * the file is actually in hand.
 *
 * The one piece of this every caller needs and each was computing itself. It is
 * separate from `audioStart` and `resolveTagEnd` because those two answer
 * different questions about the same number — one clamps to the buffer, the
 * other refuses until the buffer reaches it — and a third caller wants it raw:
 * `detect.ts` reads exactly ten bytes over the network and needs to know where
 * audio begins in a file it has not downloaded. Podcast tags run to hundreds of
 * kilobytes of cover art, so "fetch enough to contain it" is not an option
 * there.
 *
 * Returns 0 when there is no tag, and null only when fewer than ten bytes were
 * given — too little to tell the two apart.
 */
export function tagEndFromHeader(bytes: Uint8Array): number | null {
  if (bytes.length < 10) return null;
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

  return 10 + size + footer;
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

// ---------------------------------------------------------- streaming split --

/**
 * `audioStart`, for a buffer that is still arriving.
 *
 * `audioStart` clamps its answer to `bytes.length`, which is the right call for
 * a buffer holding the whole file and the wrong one for a buffer holding the
 * first few kilobytes of one: podcast cover art routinely makes an ID3v2 tag
 * hundreds of kilobytes, comfortably more than a single network read, and
 * clamping there would have the streaming chunker "skip the tag" at a point
 * still inside it and start scanning cover-art bytes for frame sync words.
 *
 * Returns `null` for "not enough has arrived to know yet" — the caller's job is
 * to wait for more and ask again, not to guess.
 */
export function resolveTagEnd(bytes: Uint8Array): number | null {
  const end = tagEndFromHeader(bytes);
  if (end === null) return null;
  return end <= bytes.length ? end : null;
}

function concatAll(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!;

  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/**
 * The same join, exported for the one caller outside this file that needs it.
 *
 * `audio.ts` keeps a small raw buffer alive only while an episode might still
 * turn out to be the small, never-recognised-as-MP3 case — untimed audio in a
 * container this module cannot parse, handed to Whisper whole rather than
 * refused on our own uncertainty. Assembling that buffer is the identical
 * "many small reads, one copy" problem `Mp3ChunkStream` solves internally, so
 * it gets the same answer rather than a second implementation of it.
 */
export function concatAllForFallback(parts: readonly Uint8Array[]): Uint8Array {
  return concatAll(parts);
}

/**
 * `chunkMp3`, fed a downloading file instead of a downloaded one.
 *
 * The reason this exists is memory, not correctness: `chunkMp3` needs the
 * whole episode in hand before it can cut the first chunk, which is exactly
 * what makes a three-hour, 320kbps interview show — a real file in this
 * catalogue, and not a rare one — cost 350MB of resident memory before a
 * single byte can be sent anywhere. This produces byte-for-byte the same
 * chunks (proven in `mp3.test.ts` against `chunkMp3` on identical input, fed
 * through every push pattern from "one call" to "one byte at a time"), while
 * never holding more than roughly one chunk's worth of data at a time —
 * independent of how long the episode runs.
 *
 * **The trick is deferred concatenation.** Pushed segments are queued as
 * references, not copied, until enough have arrived to plausibly contain a
 * full chunk; only then are they joined into one buffer and walked for a cut
 * point. That single join costs one chunk's worth of copying, not the whole
 * file's — the same total work `chunkMp3` already does, just spread across
 * many small buffers instead of paid for against one enormous one.
 *
 * **State carried between calls is a time, not a byte offset.** Byte offsets
 * into "the buffer" stop meaning anything the moment the buffer is rebuilt on
 * the next push, so what survives a call is `baseMs` alone — the elapsed
 * position of the very first retained byte. Every call re-walks `combined`
 * from its start rather than resuming mid-scan: an earlier version tried to
 * resume past the frames already confirmed by pre-seeding the loop's offset,
 * and it was wrong in exactly the way that sounds plausible and costs a day —
 * `elapsedMs` only advances *inside* the loop, so skipping straight past
 * already-known frames skipped advancing the clock for them too, and every
 * chunk after the first came out with `durationMs: 0`. Re-walking costs a
 * small constant multiple of CPU, because `readFrameHeader` is pure and cheap;
 * getting the clock right is worth every cycle of it.
 */
export class Mp3ChunkStream {
  private readonly maxBytes: number;

  private retained: Uint8Array[] = [];
  private retainedBytes = 0;
  private tagResolved = false;

  /** Elapsed-ms position of the first byte of `retained`. */
  private baseMs = 0;
  /** How far frame-walking has progressed, for `totalDurationMs` once streaming ends. */
  private walkedMs = 0;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  /** Feed the next bytes as they arrive. Returns any chunks now complete, in order. */
  push(segment: Uint8Array): Mp3Chunk[] {
    if (segment.byteLength === 0) return [];

    this.retained.push(segment);
    this.retainedBytes += segment.byteLength;

    return this.retainedBytes >= this.maxBytes ? this.drain(false) : [];
  }

  /** No more data. Emits whatever remains as a final, possibly under-sized, chunk. */
  finish(): Mp3Chunk[] {
    return this.drain(true);
  }

  /** Total duration walked so far — the true episode length once `finish()` has run. */
  get totalDurationMs(): number {
    return Math.round(this.walkedMs);
  }

  private drain(final: boolean): Mp3Chunk[] {
    if (this.retainedBytes === 0) return [];

    const combined = concatAll(this.retained);

    let scanStart = 0;
    if (!this.tagResolved) {
      const end = resolveTagEnd(combined);
      if (end === null) {
        if (!final) {
          this.retained = [combined];
          return [];
        }
        // The stream ended mid-tag. There is no audio to recover from a file
        // that is nothing but a partial cover-art payload.
        this.retained = [];
        this.retainedBytes = 0;
        return [];
      }
      scanStart = end;
      this.tagResolved = true;
    }

    let chunkStart = -1;
    let chunkEnd = -1;
    let chunkStartMs = this.baseMs;
    let elapsedMs = this.baseMs;
    let offset = scanStart;

    const out: Mp3Chunk[] = [];

    while (offset + 4 <= combined.length) {
      const header = readFrameHeader(combined, offset);

      if (!header) {
        offset += 1;
        continue;
      }

      // The tail of what has arrived so far, mid-frame. Wait for more, unless
      // this is genuinely the end of the download — then it is a truncated
      // last frame, and `frames()` would stop here too.
      if (!final && header.offset + header.length > combined.length) break;

      if (chunkStart >= 0 && chunkEnd - chunkStart + header.length > this.maxBytes) {
        out.push({
          bytes: combined.subarray(chunkStart, chunkEnd),
          startMs: Math.round(chunkStartMs),
          durationMs: Math.round(elapsedMs) - Math.round(chunkStartMs),
        });
        chunkStart = -1;
      }

      if (chunkStart < 0) {
        chunkStart = header.offset;
        chunkStartMs = elapsedMs;
      }

      chunkEnd = header.offset + header.length;
      elapsedMs += header.durationMs;
      offset = chunkEnd;
    }

    this.walkedMs = elapsedMs;

    if (final) {
      if (chunkStart >= 0 && chunkEnd > chunkStart) {
        out.push({
          bytes: combined.subarray(chunkStart, chunkEnd),
          startMs: Math.round(chunkStartMs),
          durationMs: Math.round(elapsedMs) - Math.round(chunkStartMs),
        });
      }
      this.retained = [];
      this.retainedBytes = 0;
      return out;
    }

    /*
      What to keep for next time, and where its clock starts.

      Mid-chunk, that is everything from the chunk's own first byte onward —
      including any not-yet-complete tail frame past `chunkEnd`, which may
      complete on the next push — and the clock resumes at that chunk's own
      start, because the whole chunk gets re-walked next time (see the class
      doc). At a clean boundary it is whatever the scan could not yet resolve
      (a partial header, or nothing at all), and the clock resumes at `offset`,
      the point scanning actually reached.
    */
    const carryFrom = chunkStart >= 0 ? chunkStart : offset;
    const carry = combined.subarray(carryFrom);
    this.retained = carry.byteLength > 0 ? [carry] : [];
    this.retainedBytes = carry.byteLength;
    this.baseMs = chunkStart >= 0 ? chunkStartMs : elapsedMs;

    return out;
  }
}
