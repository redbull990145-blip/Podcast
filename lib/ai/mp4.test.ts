import { describe, expect, it } from "vitest";
import {
  buildM4A,
  buildSampleTable,
  findBox,
  parseAudioTrack,
  planSampleGroups,
  readBoxes,
  sampleRange,
  samplesPerChunk,
} from "./mp4";

// --- helpers ----------------------------------------------------------------

function mkBox(type: string, ...parts: (Uint8Array | number[])[]): Uint8Array {
  const payload = parts.flatMap((p) => Array.from(p));
  const out = new Uint8Array(8 + payload.length);
  const size = out.length;
  out.set([(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff]);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(payload, 8);
  return out;
}

const be32 = (...values: number[]) =>
  values.flatMap((v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);

/**
 * A stand-in sample description. Its contents are never interpreted — the whole
 * point is that it is copied byte-for-byte — so a recognisable marker is more
 * useful here than a faithful mp4a entry.
 */
const FAKE_STSD = mkBox("stsd", be32(0, 1), mkBox("mp4a", [0xab, 0xcd, 0xef, 0x01]));

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

// --- reading ----------------------------------------------------------------

describe("readBoxes", () => {
  it("lists boxes laid out end to end", () => {
    const bytes = concat(mkBox("ftyp", [1, 2, 3, 4]), mkBox("moov", [5, 6]));
    expect(readBoxes(bytes).map((b) => b.type)).toEqual(["ftyp", "moov"]);
  });

  it("reports payload boundaries, not just the header", () => {
    const bytes = mkBox("free", [9, 9, 9, 9]);
    const [box] = readBoxes(bytes);
    expect(box.dataStart).toBe(8);
    expect(box.end).toBe(12); // 8-byte header + 4-byte payload
    expect(bytes.slice(box.dataStart, box.end)).toEqual(new Uint8Array([9, 9, 9, 9]));
  });

  it("reads a 64-bit extended size", () => {
    // size == 1 means the real length follows the type as a 64-bit value.
    const bytes = new Uint8Array(24);
    bytes.set(be32(1), 0);
    bytes.set([...("mdat" as string)].map((c) => c.charCodeAt(0)), 4);
    bytes.set(be32(0, 24), 8); // 64-bit length of 24
    const [box] = readBoxes(bytes);
    expect(box.type).toBe("mdat");
    expect(box.end).toBe(24);
    expect(box.dataStart).toBe(16);
  });

  it("still reports a box whose declared size runs past the buffer", () => {
    // This is the signal the moov-locating walk relies on: how far a box
    // continues beyond what has been fetched so far.
    const header = new Uint8Array(8);
    header.set(be32(5000), 0);
    header.set([...("mdat" as string)].map((c) => c.charCodeAt(0)), 4);
    const [box] = readBoxes(header);
    expect(box.type).toBe("mdat");
    expect(box.end).toBe(5000);
  });

  it("treats a zero size as running to the end", () => {
    const bytes = new Uint8Array(20);
    bytes.set(be32(0), 0);
    bytes.set([...("mdat" as string)].map((c) => c.charCodeAt(0)), 4);
    expect(readBoxes(bytes)[0].end).toBe(20);
  });

  it("stops cleanly on a nonsense length rather than looping", () => {
    const bytes = new Uint8Array(16);
    bytes.set(be32(2), 0); // smaller than the 8-byte header
    bytes.set([...("junk" as string)].map((c) => c.charCodeAt(0)), 4);
    expect(readBoxes(bytes)).toEqual([]);
  });

  it("returns nothing for a buffer too short to hold a header", () => {
    expect(readBoxes(new Uint8Array(4))).toEqual([]);
  });
});

describe("findBox", () => {
  const tree = concat(
    mkBox("ftyp", [0]),
    mkBox("moov", mkBox("trak", mkBox("mdia", mkBox("mdhd", be32(0xdeadbeef))))),
  );

  it("descends through nested containers", () => {
    const found = findBox(tree, ["moov", "trak", "mdia", "mdhd"]);
    expect(found).not.toBeNull();
    expect(tree.slice(found!.dataStart, found!.end)).toEqual(
      new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    );
  });

  it("returns null when any step of the path is missing", () => {
    expect(findBox(tree, ["moov", "trak", "minf"])).toBeNull();
    expect(findBox(tree, ["nope"])).toBeNull();
  });

  it("does not find a nested box at the top level", () => {
    // mdhd exists, but not as a child of the root.
    expect(findBox(tree, ["mdhd"])).toBeNull();
  });
});

// --- sample tables ----------------------------------------------------------

describe("samplesPerChunk", () => {
  // stsc stores changes: entry {firstChunk} applies until the next one starts.
  const entries = [
    { firstChunk: 1, samplesPerChunk: 4 },
    { firstChunk: 3, samplesPerChunk: 2 },
  ];

  it("applies an entry to every chunk until the next takes over", () => {
    expect(samplesPerChunk(entries, 1)).toBe(4);
    expect(samplesPerChunk(entries, 2)).toBe(4);
    expect(samplesPerChunk(entries, 3)).toBe(2);
    expect(samplesPerChunk(entries, 99)).toBe(2);
  });

  it("is zero when no entry covers the chunk", () => {
    expect(samplesPerChunk([{ firstChunk: 5, samplesPerChunk: 3 }], 1)).toBe(0);
    expect(samplesPerChunk([], 1)).toBe(0);
  });
});

describe("buildSampleTable", () => {
  it("lays samples out consecutively from each chunk's offset", () => {
    const samples = buildSampleTable(
      [10, 20, 30, 40],
      [1024, 1024, 1024, 1024],
      [{ firstChunk: 1, samplesPerChunk: 2 }],
      [1000, 5000],
    );

    expect(samples).toEqual([
      { offset: 1000, size: 10, duration: 1024 },
      { offset: 1010, size: 20, duration: 1024 },
      { offset: 5000, size: 30, duration: 1024 },
      { offset: 5030, size: 40, duration: 1024 },
    ]);
  });

  it("honours a mid-file change in samples per chunk", () => {
    const samples = buildSampleTable(
      [1, 1, 1, 1, 1],
      new Array(5).fill(512),
      [
        { firstChunk: 1, samplesPerChunk: 3 },
        { firstChunk: 2, samplesPerChunk: 2 },
      ],
      [100, 200],
    );

    expect(samples.map((s) => s.offset)).toEqual([100, 101, 102, 200, 201]);
  });

  it("stops at the sample count even when chunks claim more", () => {
    const samples = buildSampleTable(
      [5, 5],
      [512, 512],
      [{ firstChunk: 1, samplesPerChunk: 10 }],
      [0],
    );
    expect(samples).toHaveLength(2);
  });
});

// --- planning ---------------------------------------------------------------

describe("planSampleGroups", () => {
  const sized = (...sizes: number[]) =>
    sizes.map((size, i) => ({ offset: i * 100, size, duration: 1024 }));

  it("fills a group up to the budget and starts a new one", () => {
    expect(planSampleGroups(sized(4, 4, 4, 4), 8)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("keeps everything in one group when it fits", () => {
    expect(planSampleGroups(sized(1, 1, 1), 100)).toEqual([{ start: 0, end: 3 }]);
  });

  it("never splits inside a sample — an oversized one gets its own group", () => {
    // Half an AAC frame decodes to nothing, so a sample bigger than the budget
    // must still be emitted whole rather than cut or dropped.
    expect(planSampleGroups(sized(2, 500, 2), 10)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ]);
  });

  it("covers every sample exactly once, contiguously", () => {
    const groups = planSampleGroups(sized(3, 3, 3, 3, 3, 3, 3), 7);
    expect(groups[0].start).toBe(0);
    expect(groups[groups.length - 1].end).toBe(7);
    for (let i = 1; i < groups.length; i += 1) {
      expect(groups[i].start).toBe(groups[i - 1].end);
    }
  });

  it("returns nothing for no samples", () => {
    expect(planSampleGroups([], 100)).toEqual([]);
  });
});

describe("sampleRange", () => {
  it("spans from the first byte to the last across the group", () => {
    const samples = [
      { offset: 100, size: 10, duration: 0 },
      { offset: 110, size: 5, duration: 0 },
      { offset: 200, size: 7, duration: 0 },
    ];
    expect(sampleRange(samples, 0, 3)).toEqual({ start: 100, end: 207 });
    expect(sampleRange(samples, 1, 2)).toEqual({ start: 110, end: 115 });
  });

  it("is empty for an empty group", () => {
    expect(sampleRange([], 0, 0)).toEqual({ start: 0, end: 0 });
  });
});

// --- writing ----------------------------------------------------------------

describe("buildM4A", () => {
  const track = { timescale: 44100, stsd: FAKE_STSD };

  // Three samples living at 100..115 of some larger source file.
  const samples = [
    { offset: 100, size: 4, duration: 1024 },
    { offset: 104, size: 6, duration: 1024 },
    { offset: 110, size: 5, duration: 1024 },
  ];
  const sourceStart = 100;
  const sourceData = new Uint8Array([
    1, 1, 1, 1, // sample 0
    2, 2, 2, 2, 2, 2, // sample 1
    3, 3, 3, 3, 3, // sample 2
  ]);

  const file = buildM4A(track, samples, sourceData, sourceStart);

  it("writes a self-contained file: ftyp, moov, then mdat", () => {
    expect(readBoxes(file).map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
  });

  it("declares sizes that account for every byte, with nothing left over", () => {
    const boxes = readBoxes(file);
    expect(boxes[boxes.length - 1].end).toBe(file.length);
  });

  it("copies the audio payload in sample order", () => {
    const mdat = readBoxes(file).find((b) => b.type === "mdat")!;
    expect(file.slice(mdat.dataStart, mdat.end)).toEqual(sourceData);
  });

  it("round-trips: the rebuilt index reads back the samples it was given", () => {
    const moov = readBoxes(file).find((b) => b.type === "moov")!;
    const track2 = parseAudioTrack(file.slice(moov.dataStart, moov.end));

    expect(track2).not.toBeNull();
    expect(track2!.timescale).toBe(44100);
    expect(track2!.samples.map((s) => s.size)).toEqual([4, 6, 5]);
    expect(track2!.samples.map((s) => s.duration)).toEqual([1024, 1024, 1024]);
  });

  it("points the rebuilt offsets at the real bytes in the new file", () => {
    // The offsets in the output are meaningless unless they address the new
    // mdat — this is the mistake that would produce a file that parses but
    // decodes to garbage, so it is checked against the actual bytes.
    const moov = readBoxes(file).find((b) => b.type === "moov")!;
    const track2 = parseAudioTrack(file.slice(moov.dataStart, moov.end))!;

    const read = track2.samples.map((s) => Array.from(file.slice(s.offset, s.offset + s.size)));
    expect(read).toEqual([
      [1, 1, 1, 1],
      [2, 2, 2, 2, 2, 2],
      [3, 3, 3, 3, 3],
    ]);
  });

  it("preserves the codec configuration byte for byte", () => {
    // stsd carries the AAC AudioSpecificConfig; a chunk whose stsd differs from
    // the original decodes differently, or not at all.
    const moov = readBoxes(file).find((b) => b.type === "moov")!;
    const track2 = parseAudioTrack(file.slice(moov.dataStart, moov.end))!;
    expect(track2.stsd).toEqual(FAKE_STSD);
  });

  it("gathers samples that were scattered across the source into one run", () => {
    // Source samples with a gap between them (separate mdat chunks) must come
    // out packed contiguously, with the index updated to match.
    const scattered = [
      { offset: 0, size: 3, duration: 512 },
      { offset: 50, size: 3, duration: 512 },
    ];
    const data = new Uint8Array(53);
    data.set([7, 7, 7], 0);
    data.set([8, 8, 8], 50);

    const out = buildM4A(track, scattered, data, 0);
    const moov = readBoxes(out).find((b) => b.type === "moov")!;
    const parsed = parseAudioTrack(out.slice(moov.dataStart, moov.end))!;

    expect(parsed.samples[1].offset).toBe(parsed.samples[0].offset + 3);
    expect(Array.from(out.slice(parsed.samples[1].offset, parsed.samples[1].offset + 3))).toEqual([
      8, 8, 8,
    ]);
  });

  it("records the total duration on the track", () => {
    const moov = readBoxes(file).find((b) => b.type === "moov")!;
    const mdhd = findBox(file, ["trak", "mdia", "mdhd"], moov.dataStart, moov.end)!;
    const duration =
      (file[mdhd.dataStart + 16] << 24) |
      (file[mdhd.dataStart + 17] << 16) |
      (file[mdhd.dataStart + 18] << 8) |
      file[mdhd.dataStart + 19];
    expect(duration).toBe(3 * 1024);
  });
});

describe("parseAudioTrack", () => {
  it("returns null when there is no sound track to read", () => {
    const moov = mkBox("moov", mkBox("trak", mkBox("mdia", mkBox("mdhd", be32(0)))));
    expect(parseAudioTrack(moov.slice(8))).toBeNull();
  });

  it("returns null when the sample tables are incomplete", () => {
    const hdlr = mkBox("hdlr", be32(0, 0), [0x73, 0x6f, 0x75, 0x6e], new Uint8Array(12));
    const mdhd = mkBox("mdhd", be32(0, 0, 0, 44100, 0), [0x55, 0xc4, 0, 0]);
    // stbl present but missing stsz/stsc/stco.
    const stbl = mkBox("stbl", FAKE_STSD);
    const mdia = mkBox("mdia", mdhd, hdlr, mkBox("minf", stbl));
    const moov = mkBox("moov", mkBox("trak", mdia));
    expect(parseAudioTrack(moov.slice(8))).toBeNull();
  });

  it("skips a non-audio track and finds the audio one after it", () => {
    const videoHdlr = mkBox("hdlr", be32(0, 0), [0x76, 0x69, 0x64, 0x65], new Uint8Array(12));
    const videoTrak = mkBox("trak", mkBox("mdia", videoHdlr));

    // A real audio track, produced by the writer so it is known-good.
    const audio = buildM4A(
      { timescale: 48000, stsd: FAKE_STSD },
      [{ offset: 0, size: 2, duration: 1024 }],
      new Uint8Array([1, 2]),
      0,
    );
    const audioMoov = readBoxes(audio).find((b) => b.type === "moov")!;
    const audioTrak = findBox(audio, ["trak"], audioMoov.dataStart, audioMoov.end)!;

    const combined = concat(videoTrak, audio.slice(audioTrak.start, audioTrak.end));
    const parsed = parseAudioTrack(combined);

    expect(parsed).not.toBeNull();
    expect(parsed!.timescale).toBe(48000);
  });
});
