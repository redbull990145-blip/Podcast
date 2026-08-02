/**
 * Just enough MP4/M4A handling to cut an AAC podcast into transcribable pieces.
 *
 * MP3 can be split anywhere: every frame carries its own sync word, so a decoder
 * handed the middle of a file finds its footing within a frame or two. MP4
 * cannot. The audio frames sit in one opaque `mdat` blob, and everything needed
 * to interpret them — where each frame begins, how long it lasts, which codec
 * decodes it — lives in a separate `moov` index elsewhere in the file. A byte
 * slice of the middle of an M4A is therefore not audio at all, just headerless
 * bytes, which is exactly why Whisper rejects every such chunk with "could not
 * process file".
 *
 * The way out is to repackage rather than slice. Read the sample index once,
 * then for each group of frames emit a brand-new, self-contained little M4A
 * carrying a rewritten `moov` describing exactly those frames. Each piece is a
 * valid file in its own right, and the codec configuration (`stsd`, which holds
 * the AAC AudioSpecificConfig) is copied across byte-for-byte, so a chunk
 * decodes identically to the stretch of the original it came from.
 *
 * Only the boxes that matter for a single audio track are understood. Anything
 * else — video tracks, edit lists, chapter tracks, cover art — is ignored, and
 * a file whose audio track can't be read is reported as unparseable so the
 * caller can fall back rather than emit something subtly wrong.
 */

export type Mp4Box = {
  type: string;
  /** Offset of the box header within the buffer it was read from. */
  start: number;
  /** Offset just past the box, per its declared size. May exceed the buffer. */
  end: number;
  /** Offset of the box's payload, past size/type (and largesize when present). */
  dataStart: number;
};

/** One audio frame: where it lives in the source file, and how long it plays. */
export type Mp4Sample = {
  offset: number;
  size: number;
  /** Duration in media timescale units. */
  duration: number;
};

export type Mp4AudioTrack = {
  /** Media timescale — units per second, usually the sample rate. */
  timescale: number;
  samples: Mp4Sample[];
  /**
   * The complete `stsd` box, copied verbatim.
   *
   * This is the one box that must survive untouched: nested inside it is the
   * `esds`/AudioSpecificConfig that tells a decoder the profile, sample rate and
   * channel layout. Rebuilding it from parsed fields would risk describing the
   * audio slightly differently from how it was encoded; copying the bytes
   * cannot.
   */
  stsd: Uint8Array;
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function u32(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function u64(b: Uint8Array, i: number): number {
  // Podcast files are far below 2^53, so the precision loss a true 64-bit value
  // would suffer here cannot occur in practice.
  return u32(b, i) * 2 ** 32 + u32(b, i + 4);
}

function boxType(b: Uint8Array, i: number): string {
  return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
}

/**
 * Lists the boxes laid out between `start` and `end`.
 *
 * A box declaring a size that runs past the buffer is still returned — with its
 * declared `end` — because that is precisely the signal the moov-locating walk
 * needs: it says "this box continues beyond what you fetched, and here is how
 * far". Callers that intend to read a box's contents must check `end` against
 * the buffer length themselves.
 */
export function readBoxes(bytes: Uint8Array, start = 0, end = bytes.length): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = start;

  while (offset + 8 <= end) {
    let size = u32(bytes, offset);
    const type = boxType(bytes, offset + 4);
    let dataStart = offset + 8;

    if (size === 1) {
      // Extended size: a 64-bit length follows the type.
      if (offset + 16 > end) break;
      size = u64(bytes, offset + 8);
      dataStart = offset + 16;
    } else if (size === 0) {
      // "Runs to the end of the file" — only legal for the last box.
      size = end - offset;
    }

    if (size < dataStart - offset) break; // Nonsense length; stop cleanly.

    boxes.push({ type, start: offset, end: offset + size, dataStart });

    if (offset + size > end) break; // Truncated: reported, but nothing follows.
    offset += size;
  }

  return boxes;
}

/**
 * Descends a path of container boxes, e.g. ["mdia", "minf", "stbl"].
 *
 * Only plain container boxes can be descended into — their payload is nothing
 * but child boxes. That covers everything on the paths used here; `stsd` is a
 * full box with a count ahead of its children and is never descended into.
 */
export function findBox(
  bytes: Uint8Array,
  path: string[],
  start = 0,
  end = bytes.length,
): Mp4Box | null {
  let scopeStart = start;
  let scopeEnd = end;
  let found: Mp4Box | null = null;

  for (const type of path) {
    found = readBoxes(bytes, scopeStart, scopeEnd).find((b) => b.type === type) ?? null;
    if (!found) return null;
    scopeStart = found.dataStart;
    scopeEnd = Math.min(found.end, end);
  }

  return found;
}

type StscEntry = { firstChunk: number; samplesPerChunk: number };

/** Expands `stts`'s run-length encoding into one duration per sample. */
function parseStts(bytes: Uint8Array, box: Mp4Box): number[] {
  const durations: number[] = [];
  const count = u32(bytes, box.dataStart + 4);
  let p = box.dataStart + 8;

  for (let i = 0; i < count && p + 8 <= box.end; i += 1, p += 8) {
    const runLength = u32(bytes, p);
    const delta = u32(bytes, p + 4);
    // A corrupt run count could otherwise allocate unboundedly.
    for (let k = 0; k < runLength && durations.length < 5_000_000; k += 1) {
      durations.push(delta);
    }
  }

  return durations;
}

/** Reads `stsz`, handling the constant-size shorthand. */
function parseStsz(bytes: Uint8Array, box: Mp4Box): number[] {
  const constantSize = u32(bytes, box.dataStart + 4);
  const count = u32(bytes, box.dataStart + 8);

  if (constantSize > 0) return new Array<number>(count).fill(constantSize);

  const sizes: number[] = [];
  let p = box.dataStart + 12;
  for (let i = 0; i < count && p + 4 <= box.end; i += 1, p += 4) {
    sizes.push(u32(bytes, p));
  }
  return sizes;
}

function parseStsc(bytes: Uint8Array, box: Mp4Box): StscEntry[] {
  const entries: StscEntry[] = [];
  const count = u32(bytes, box.dataStart + 4);
  let p = box.dataStart + 8;

  for (let i = 0; i < count && p + 12 <= box.end; i += 1, p += 12) {
    entries.push({ firstChunk: u32(bytes, p), samplesPerChunk: u32(bytes, p + 4) });
  }

  return entries;
}

function parseChunkOffsets(bytes: Uint8Array, box: Mp4Box, wide: boolean): number[] {
  const offsets: number[] = [];
  const count = u32(bytes, box.dataStart + 4);
  const width = wide ? 8 : 4;
  let p = box.dataStart + 8;

  for (let i = 0; i < count && p + width <= box.end; i += 1, p += width) {
    offsets.push(wide ? u64(bytes, p) : u32(bytes, p));
  }

  return offsets;
}

/**
 * How many samples chunk `chunkNumber` (1-based) holds.
 *
 * `stsc` is stored as changes rather than a full list: an entry applies to every
 * chunk from its `firstChunk` until the next entry takes over.
 */
export function samplesPerChunk(entries: StscEntry[], chunkNumber: number): number {
  let result = 0;
  for (const entry of entries) {
    if (entry.firstChunk > chunkNumber) break;
    result = entry.samplesPerChunk;
  }
  return result;
}

/**
 * Turns the four separate tables into one flat list of samples.
 *
 * MP4 splits this information deliberately — sizes in `stsz`, grouping in
 * `stsc`, group positions in `stco`, timing in `stts` — because that compresses
 * well. Walking them together once, up front, is far easier to reason about
 * than consulting four tables at every use.
 */
export function buildSampleTable(
  sizes: number[],
  durations: number[],
  stsc: StscEntry[],
  chunkOffsets: number[],
): Mp4Sample[] {
  const samples: Mp4Sample[] = [];
  let index = 0;

  for (let chunk = 0; chunk < chunkOffsets.length && index < sizes.length; chunk += 1) {
    const perChunk = samplesPerChunk(stsc, chunk + 1);
    let offset = chunkOffsets[chunk];

    for (let k = 0; k < perChunk && index < sizes.length; k += 1) {
      const size = sizes[index];
      samples.push({ offset, size, duration: durations[index] ?? 0 });
      offset += size;
      index += 1;
    }
  }

  return samples;
}

/**
 * Reads the audio track out of a `moov` payload.
 *
 * Returns null when there is no readable audio track, so the caller can fall
 * back to something safe rather than proceed on a half-understood file.
 */
export function parseAudioTrack(moov: Uint8Array): Mp4AudioTrack | null {
  const traks = readBoxes(moov).filter((b) => b.type === "trak");

  for (const trak of traks) {
    const mdia = findBox(moov, ["mdia"], trak.dataStart, trak.end);
    if (!mdia) continue;

    // A file can carry several tracks; only the sound one is wanted. The
    // handler type sits past the full-box header and one pre_defined field.
    const hdlr = findBox(moov, ["hdlr"], mdia.dataStart, mdia.end);
    if (!hdlr || boxType(moov, hdlr.dataStart + 8) !== "soun") continue;

    const mdhd = findBox(moov, ["mdhd"], mdia.dataStart, mdia.end);
    const stbl = findBox(moov, ["minf", "stbl"], mdia.dataStart, mdia.end);
    if (!mdhd || !stbl) continue;

    const version = moov[mdhd.dataStart];
    // Version 1 widens the creation/modification times to 64 bits, pushing
    // timescale from offset 12 to offset 20.
    const timescale = u32(moov, mdhd.dataStart + (version === 1 ? 20 : 12));
    if (!timescale) continue;

    const children = readBoxes(moov, stbl.dataStart, stbl.end);
    const pick = (type: string) => children.find((b) => b.type === type) ?? null;

    const stsd = pick("stsd");
    const stts = pick("stts");
    const stsz = pick("stsz");
    const stsc = pick("stsc");
    const stco = pick("stco");
    const co64 = pick("co64");

    if (!stsd || !stts || !stsz || !stsc || !(stco || co64)) continue;

    const samples = buildSampleTable(
      parseStsz(moov, stsz),
      parseStts(moov, stts),
      parseStsc(moov, stsc),
      parseChunkOffsets(moov, (stco ?? co64)!, !stco),
    );

    if (samples.length === 0) continue;

    return {
      timescale,
      samples,
      stsd: moov.slice(stsd.start, Math.min(stsd.end, moov.length)),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Groups consecutive samples into runs of at most `maxBytes` of audio data.
 *
 * Splitting only ever happens between whole samples, never inside one — half an
 * AAC frame decodes to nothing. A single sample larger than the budget still
 * gets a group to itself rather than being dropped or looping forever.
 */
export function planSampleGroups(
  samples: Mp4Sample[],
  maxBytes: number,
): { start: number; end: number }[] {
  const groups: { start: number; end: number }[] = [];
  let start = 0;
  let bytes = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const size = samples[i].size;
    if (bytes > 0 && bytes + size > maxBytes) {
      groups.push({ start, end: i });
      start = i;
      bytes = 0;
    }
    bytes += size;
  }

  if (start < samples.length) groups.push({ start, end: samples.length });
  return groups;
}

/**
 * Exact playback duration of a group of samples, in seconds.
 *
 * The sample table carries a per-sample duration in timescale units, so unlike
 * the MP3 side this is exact with nothing left over — the group is a whole
 * number of samples and every one of them declares its own length.
 *
 * This is what places the group on the episode timeline. Deriving that position
 * from where Whisper's last word landed instead loses whatever silence or music
 * the group ended on, and because a boundary can only lose time the error
 * accumulates forwards through the episode. See
 * plans/005-caption-sync-accuracy.md.
 */
export function groupSeconds(
  track: Pick<Mp4AudioTrack, "samples" | "timescale">,
  group: { start: number; end: number },
): number | null {
  if (!(track.timescale > 0)) return null;

  let units = 0;
  for (let i = group.start; i < group.end; i += 1) {
    units += track.samples[i]?.duration ?? 0;
  }

  return units > 0 ? units / track.timescale : null;
}

/** The byte span of the source file a group of samples occupies. */
export function sampleRange(
  samples: Mp4Sample[],
  start: number,
  end: number,
): { start: number; end: number } {
  let low = Infinity;
  let high = 0;
  for (let i = start; i < end; i += 1) {
    low = Math.min(low, samples[i].offset);
    high = Math.max(high, samples[i].offset + samples[i].size);
  }
  return low === Infinity ? { start: 0, end: 0 } : { start: low, end: high };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function u32Bytes(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  values.forEach((v, i) => writeU32(out, i * 4, v));
  return out;
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(8 + length);
  writeU32(out, 0, out.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  let offset = 8;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Identity transform, required in `mvhd`/`tkhd` even for audio-only files. */
const UNITY_MATRIX = u32Bytes(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);

function mvhd(timescale: number, duration: number): Uint8Array {
  return box(
    "mvhd",
    u32Bytes(0, 0, 0, timescale, duration, 0x00010000),
    new Uint8Array([0x01, 0x00]), // volume 1.0
    new Uint8Array(10), // reserved
    UNITY_MATRIX,
    new Uint8Array(24), // pre_defined
    u32Bytes(2), // next_track_ID
  );
}

function tkhd(duration: number): Uint8Array {
  return box(
    "tkhd",
    // Flags 0x7: track is enabled, in the movie, and in previews.
    new Uint8Array([0, 0, 0, 0x07]),
    u32Bytes(0, 0, 1, 0, duration),
    new Uint8Array(8), // reserved
    new Uint8Array([0, 0, 0, 0]), // layer, alternate_group
    new Uint8Array([0x01, 0x00, 0, 0]), // volume 1.0, reserved
    UNITY_MATRIX,
    u32Bytes(0, 0), // width, height — zero for audio
  );
}

function mdhd(timescale: number, duration: number): Uint8Array {
  return box(
    "mdhd",
    u32Bytes(0, 0, 0, timescale, duration),
    // 0x55C4 packs "und" into the five-bits-per-letter language field.
    new Uint8Array([0x55, 0xc4, 0, 0]),
  );
}

function hdlr(): Uint8Array {
  const name = new TextEncoder().encode("SoundHandler\0");
  return box(
    "hdlr",
    u32Bytes(0, 0),
    new Uint8Array([0x73, 0x6f, 0x75, 0x6e]), // "soun"
    new Uint8Array(12), // reserved
    name,
  );
}

function dinf(): Uint8Array {
  // A "url " entry with flag 1 means the media is in this same file, which is
  // what makes each chunk self-contained.
  const url = box("url ", new Uint8Array([0, 0, 0, 1]));
  return box("dinf", box("dref", u32Bytes(0, 1), url));
}

/** Re-encodes per-sample durations back into `stts` runs. */
function stts(samples: Mp4Sample[]): Uint8Array {
  const runs: { count: number; delta: number }[] = [];
  for (const sample of samples) {
    const last = runs[runs.length - 1];
    if (last && last.delta === sample.duration) last.count += 1;
    else runs.push({ count: 1, delta: sample.duration });
  }

  const table = new Uint8Array(runs.length * 8);
  runs.forEach((run, i) => {
    writeU32(table, i * 8, run.count);
    writeU32(table, i * 8 + 4, run.delta);
  });

  return box("stts", u32Bytes(0, runs.length), table);
}

function stsz(samples: Mp4Sample[]): Uint8Array {
  const table = new Uint8Array(samples.length * 4);
  samples.forEach((sample, i) => writeU32(table, i * 4, sample.size));
  // sample_size 0 means "sizes follow individually".
  return box("stsz", u32Bytes(0, 0, samples.length), table);
}

function stsc(sampleCount: number): Uint8Array {
  // Everything goes in one chunk, so a single entry describes the whole file:
  // from chunk 1 onward, every chunk holds all the samples, description 1.
  return box("stsc", u32Bytes(0, 1, 1, sampleCount, 1));
}

function stco(mdatPayloadOffset: number): Uint8Array {
  return box("stco", u32Bytes(0, 1, mdatPayloadOffset));
}

/** The `ftyp` every output chunk carries. Plain, unfragmented M4A audio. */
function ftyp(): Uint8Array {
  const brand = (s: string) => new TextEncoder().encode(s);
  return box(
    "ftyp",
    brand("M4A "),
    u32Bytes(0x200),
    brand("M4A "),
    brand("mp42"),
    brand("isom"),
  );
}

function buildMoov(
  track: Pick<Mp4AudioTrack, "timescale" | "stsd">,
  samples: Mp4Sample[],
  mdatPayloadOffset: number,
): Uint8Array {
  const duration = samples.reduce((sum, s) => sum + s.duration, 0);

  const stbl = box(
    "stbl",
    track.stsd,
    stts(samples),
    stsc(samples.length),
    stsz(samples),
    stco(mdatPayloadOffset),
  );

  const minf = box("minf", box("smhd", new Uint8Array(8)), dinf(), stbl);
  const mdia = box("mdia", mdhd(track.timescale, duration), hdlr(), minf);
  const trak = box("trak", tkhd(duration), mdia);

  // The movie timescale is deliberately set to the media timescale, so the two
  // durations are the same number and there is no rounding between them.
  return box("moov", mvhd(track.timescale, duration), trak);
}

/**
 * Assembles one standalone M4A holding just the given samples.
 *
 * `data` is a contiguous slice of the source file starting at `dataStart` and
 * covering every sample in the group; the samples are copied out of it in
 * order and written back to back, which is why the rebuilt `stco` needs only a
 * single entry pointing at the start of the new `mdat`.
 */
export function buildM4A(
  track: Pick<Mp4AudioTrack, "timescale" | "stsd">,
  samples: Mp4Sample[],
  data: Uint8Array,
  dataStart: number,
): Uint8Array {
  const payloadLength = samples.reduce((sum, s) => sum + s.size, 0);
  const payload = new Uint8Array(payloadLength);

  let written = 0;
  for (const sample of samples) {
    const from = sample.offset - dataStart;
    payload.set(data.subarray(from, from + sample.size), written);
    written += sample.size;
  }

  // Built twice on purpose. The chunk offset stored inside the moov is the
  // position of the mdat payload in the finished file, which depends on how
  // long the moov itself is — so the first pass measures, and the second
  // writes the real value. Both passes produce identical lengths, because the
  // offset is a fixed-width field.
  const header = ftyp();
  const probe = buildMoov(track, samples, 0);
  const mdatPayloadOffset = header.length + probe.length + 8;
  const moov = buildMoov(track, samples, mdatPayloadOffset);

  const out = new Uint8Array(header.length + moov.length + 8 + payloadLength);
  out.set(header, 0);
  out.set(moov, header.length);

  const mdatStart = header.length + moov.length;
  writeU32(out, mdatStart, 8 + payloadLength);
  out.set(new TextEncoder().encode("mdat"), mdatStart + 4);
  out.set(payload, mdatStart + 8);

  return out;
}
