import { describe, expect, it } from "vitest";
import { parseCueFormat, parseJsonTranscript, parseTimestamp } from "./transcript";

describe("parseTimestamp", () => {
  it("reads full hh:mm:ss.mmm", () => {
    expect(parseTimestamp("01:02:03.500")).toBeCloseTo(3723.5);
  });

  it("reads SRT's comma decimal separator", () => {
    expect(parseTimestamp("00:00:04,250")).toBeCloseTo(4.25);
  });

  it("reads VTT's optional hours field", () => {
    expect(parseTimestamp("02:07.000")).toBeCloseTo(127);
  });

  it("rejects anything that isn't a timestamp", () => {
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("later")).toBeNull();
    expect(parseTimestamp("1:2:3:4")).toBeNull();
  });
});

describe("parseCueFormat", () => {
  it("parses WebVTT, dropping the header", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:03.000",
      "Welcome to the show.",
      "",
      "00:00:03.000 --> 00:00:06.500",
      "Today we're talking about funding.",
    ].join("\n");

    expect(parseCueFormat(vtt)).toEqual([
      { start: 0, end: 3, text: "Welcome to the show." },
      { start: 3, end: 6.5, text: "Today we're talking about funding." },
    ]);
  });

  it("parses SRT, ignoring the numeric cue ids", () => {
    const srt = [
      "1",
      "00:00:01,000 --> 00:00:02,000",
      "First line.",
      "",
      "2",
      "00:00:02,000 --> 00:00:04,000",
      "Second line.",
    ].join("\r\n");

    expect(parseCueFormat(srt)).toEqual([
      { start: 1, end: 2, text: "First line." },
      { start: 2, end: 4, text: "Second line." },
    ]);
  });

  it("strips speaker tags and other inline cue markup", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:02.000",
      "<v Alok Sama>It was a &quot;big&quot; bet.</v>",
    ].join("\n");

    expect(parseCueFormat(vtt)[0].text).toBe('It was a "big" bet.');
  });

  it("ignores cue settings trailing the end timestamp", () => {
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000 align:start position:10%\nHello.";
    expect(parseCueFormat(vtt)).toEqual([{ start: 0, end: 2, text: "Hello." }]);
  });

  it("joins multi-line cues into one segment", () => {
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nOne part\nand the rest.";
    expect(parseCueFormat(vtt)[0].text).toBe("One part and the rest.");
  });

  it("skips malformed blocks rather than failing the whole file", () => {
    const vtt = [
      "WEBVTT",
      "",
      "NOTE this is a comment, not a cue",
      "",
      "not-a-timestamp --> also-not",
      "Ignored.",
      "",
      "00:00:05.000 --> 00:00:06.000",
      "Kept.",
    ].join("\n");

    expect(parseCueFormat(vtt)).toEqual([{ start: 5, end: 6, text: "Kept." }]);
  });

  it("never lets end run before start", () => {
    const vtt = "WEBVTT\n\n00:00:10.000 --> 00:00:02.000\nBackwards.";
    const [segment] = parseCueFormat(vtt);
    expect(segment.end).toBeGreaterThanOrEqual(segment.start);
  });
});

describe("parseJsonTranscript", () => {
  it("reads the Podcasting 2.0 shape", () => {
    const json = JSON.stringify({
      segments: [
        { startTime: 0, endTime: 2.5, body: "Hello there." },
        { startTime: 2.5, endTime: 5, body: "And welcome." },
      ],
    });

    expect(parseJsonTranscript(json)).toEqual([
      { start: 0, end: 2.5, text: "Hello there." },
      { start: 2.5, end: 5, text: "And welcome." },
    ]);
  });

  it("accepts the start/end/text aliases some hosts emit", () => {
    const json = JSON.stringify({ segments: [{ start: 1, end: 2, text: "Aliased." }] });
    expect(parseJsonTranscript(json)).toEqual([{ start: 1, end: 2, text: "Aliased." }]);
  });

  it("drops entries with no usable text or timing", () => {
    const json = JSON.stringify({
      segments: [
        { startTime: 0, body: "   " },
        { body: "no timing" },
        { startTime: 3, body: "Kept." },
      ],
    });

    expect(parseJsonTranscript(json)).toEqual([{ start: 3, end: 3, text: "Kept." }]);
  });

  it("returns nothing for invalid JSON or an unexpected shape", () => {
    expect(parseJsonTranscript("{not json")).toEqual([]);
    expect(parseJsonTranscript(JSON.stringify({ cues: [] }))).toEqual([]);
  });
});
