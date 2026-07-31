import { describe, expect, it } from "vitest";
import { collapseLoops, collapseTranscriptLoops } from "./repetition";
import type { TranscriptSegment, TranscriptWord } from "@/lib/db/schema";

/** A line whose words are one second each, starting at `start`. */
function line(start: number, tokens: string[]): TranscriptSegment {
  const words: TranscriptWord[] = tokens.map((text, i) => ({
    start: start + i,
    end: start + i + 1,
    text,
  }));
  return { start, end: start + tokens.length, text: tokens.join(" "), words };
}

/** `n` copies of `token`. */
function repeat(token: string, n: number): string[] {
  return Array.from({ length: n }, () => token);
}

describe("collapseLoops", () => {
  it("collapses the loop this was written for", () => {
    // Measured shape: 27 tokens of one Hindi word, one of 166 such lines in a
    // single three-hour episode.
    const collapsed = collapseLoops(line(0, repeat("आप", 27)));
    expect(collapsed.text).toBe("आप आप");
  });

  it("leaves ordinary speech alone, by reference", () => {
    const spoken = line(0, "the club is paying them for the season".split(" "));
    expect(collapseLoops(spoken)).toBe(spoken);
  });

  it("does not touch a word said three times for emphasis", () => {
    // "no, no, no" is a real thing to say. Four in a row is not.
    const spoken = line(0, ["no", "no", "no", "then"]);
    expect(collapseLoops(spoken)).toBe(spoken);
  });

  it("collapses a repeated phrase, not just a repeated word", () => {
    const collapsed = collapseLoops(line(0, [
      "same", "thing", "same", "thing", "same", "thing", "same", "thing",
    ]));
    expect(collapsed.text).toBe("same thing same thing");
  });

  it("prefers the shortest description of a run", () => {
    // Eight of one word is also four of a pair; collapsing the pair would
    // leave twice as much of the loop behind.
    expect(collapseLoops(line(0, repeat("go", 8))).text).toBe("go go");
  });

  it("keeps the words either side of a loop", () => {
    const collapsed = collapseLoops(
      line(0, ["listen", ...repeat("um", 9), "carefully"]),
    );
    expect(collapsed.text).toBe("listen um um carefully");
  });

  it("collapses more than one loop in the same line", () => {
    const collapsed = collapseLoops(
      line(0, [...repeat("a", 6), "and", ...repeat("b", 6)]),
    );
    expect(collapsed.text).toBe("a a and b b");
  });

  it("matches loops through punctuation and case", () => {
    const collapsed = collapseLoops(
      line(0, ["Yeah", "yeah,", "yeah.", "yeah", "yeah"]),
    );
    expect(collapsed.text).toBe("Yeah yeah,");
  });

  it("keeps the line starting when it was actually said", () => {
    const source = line(10, repeat("आप", 20));
    expect(collapseLoops(source).start).toBe(source.start);
  });

  it("ends the line where its surviving words end, rather than stretching", () => {
    // Stretching the last word to cover the dropped run left a line of one word
    // running for forty-four seconds on a real episode, with the fill crawling
    // across it the whole time. A gap is the honest answer, and during a gap
    // the last real line stays lit.
    const source = line(10, repeat("आप", 20));
    const collapsed = collapseLoops(source);
    const words = collapsed.words ?? [];

    expect(words).toHaveLength(2);
    expect(collapsed.end).toBe(words[words.length - 1].end);
    expect(collapsed.end).toBeLessThan(source.end);
  });

  it("never moves a line's end later", () => {
    const source = line(0, [...repeat("um", 9), "right"]);
    expect(collapseLoops(source).end).toBeLessThanOrEqual(source.end);
  });

  it("keeps word timings lined up with the words that survived", () => {
    const collapsed = collapseLoops(
      line(0, ["listen", ...repeat("um", 9), "carefully"]),
    );
    const words = collapsed.words ?? [];
    expect(words.map((w) => w.text)).toEqual(["listen", "um", "um", "carefully"]);
    expect(words.map((w) => w.start)).toEqual([0, 1, 2, 10]);
  });

  it("drops word timings it can no longer trust rather than misaligning them", () => {
    // A words list that never matched the rendered text cannot be sliced by
    // token index; attaching it anyway would time the wrong words.
    const collapsed = collapseLoops({
      start: 0,
      end: 9,
      text: repeat("आप", 9).join(" "),
      words: [{ start: 0, end: 9, text: "आप" }],
    });
    expect(collapsed.text).toBe("आप आप");
    expect(collapsed.words).toBeUndefined();
  });

  it("is idempotent, so cleaning at both ends of the pipeline is free", () => {
    const once = collapseLoops(line(0, repeat("आप", 27)));
    expect(collapseLoops(once)).toBe(once);
  });

  it("handles a line too short to contain a loop", () => {
    const short = line(0, ["hi", "there"]);
    expect(collapseLoops(short)).toBe(short);
  });

  it("handles an empty line", () => {
    const blank = { start: 0, end: 1, text: "" };
    expect(collapseLoops(blank)).toBe(blank);
  });
});

describe("collapseTranscriptLoops", () => {
  it("returns the same array when nothing needed cleaning", () => {
    const segments = [line(0, ["all", "fine", "here"])];
    expect(collapseTranscriptLoops(segments)).toBe(segments);
  });

  it("cleans only the lines that need it", () => {
    const good = line(0, ["all", "fine", "here"]);
    const bad = line(10, repeat("आप", 12));
    const cleaned = collapseTranscriptLoops([good, bad]);

    expect(cleaned[0]).toBe(good);
    expect(cleaned[1].text).toBe("आप आप");
  });
});
