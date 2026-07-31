import { describe, expect, it } from "vitest";
import {
  EMPHASIS_RANGE,
  centreOffset,
  clampOffset,
  captionWords,
  fillFraction,
  fillingWordIndex,
  isRowVisible,
  lineEmphasis,
} from "./caption-motion";

describe("lineEmphasis", () => {
  it("gives the spoken line full weight", () => {
    expect(lineEmphasis(5, 5)).toEqual({ opacity: 1, scale: 1, blur: 0 });
  });

  it("dims a line just read exactly as much as one about to be read", () => {
    expect(lineEmphasis(4, 5)).toEqual(lineEmphasis(6, 5));
  });

  it("dims and blurs progressively with distance", () => {
    const near = lineEmphasis(6, 5);
    const far = lineEmphasis(7, 5);
    expect(far.opacity).toBeLessThan(near.opacity);
    expect(far.scale).toBeLessThan(near.scale);
    expect(far.blur).toBeGreaterThan(near.blur);
  });

  it("stops changing past the emphasis range, so distant rows never re-animate", () => {
    const floor = lineEmphasis(5 + EMPHASIS_RANGE, 5);
    expect(lineEmphasis(5 + EMPHASIS_RANGE + 1, 5)).toEqual(floor);
    expect(lineEmphasis(900, 5)).toEqual(floor);
  });

  it("keeps scaling subtle enough not to read as layout movement", () => {
    expect(lineEmphasis(900, 5).scale).toBeGreaterThanOrEqual(0.94);
  });

  it("puts every line at the floor before anything is spoken", () => {
    expect(lineEmphasis(0, -1)).toEqual(lineEmphasis(500, -1));
  });
});

describe("captionWords", () => {
  it("positions each word by how much of the rendered line it occupies", () => {
    // "a" (1+1) + "bb" (2+1) + "ccc" (3+1) = 9 characters of line.
    const words = captionWords({ start: 0, end: 9, text: "a bb ccc" });
    expect(words.map((w) => w.text)).toEqual(["a", "bb", "ccc"]);
    expect(words[0].from).toBeCloseTo(0);
    expect(words[0].to).toBeCloseTo(2 / 9);
    expect(words[1].from).toBeCloseTo(2 / 9);
    expect(words[1].to).toBeCloseTo(5 / 9);
    expect(words[2].to).toBeCloseTo(1);
  });

  it("covers the line end to end with no gaps between words", () => {
    const words = captionWords({ start: 0, end: 5, text: "one two three four" });
    expect(words[0].from).toBe(0);
    expect(words[words.length - 1].to).toBeCloseTo(1);
    for (let i = 1; i < words.length; i += 1) {
      expect(words[i].from).toBeCloseTo(words[i - 1].to);
    }
  });

  it("uses real per-word timings when they line up with the rendered words", () => {
    const words = captionWords({
      start: 0,
      end: 4,
      text: "hello world",
      words: [
        { start: 0, end: 1, text: "hello" },
        { start: 3, end: 4, text: "world" },
      ],
    });
    expect(words.map((w) => [w.start, w.end])).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  it("shares the line's own span out when there are no word timings", () => {
    // No timings at all — the common case for a publisher transcript.
    const words = captionWords({ start: 0, end: 9, text: "a bb ccc" });
    expect(words[0].start).toBeCloseTo(0);
    expect(words[0].end).toBeCloseTo(2);
    expect(words[1].end).toBeCloseTo(5);
    expect(words[2].end).toBeCloseTo(9);
  });

  it("keeps the timings it recognises and interpolates only the rest", () => {
    // Three words on screen but two timings. The two that match are used as
    // given; the one with nothing to match borrows the time left over.
    const words = captionWords({
      start: 0,
      end: 9,
      text: "a bb ccc",
      words: [
        { start: 0, end: 1, text: "a" },
        { start: 1, end: 2, text: "bb" },
      ],
    });
    expect(words[0].start).toBeCloseTo(0);
    expect(words[1].end).toBeCloseTo(2);
    expect(words[2].start).toBeCloseTo(2);
    expect(words[2].end).toBeCloseTo(9);
  });

  it("matches on the word, not on punctuation or case", () => {
    // Whisper returns a leading space and keeps the question mark attached;
    // the rendered line has neither in the same place.
    const words = captionWords({
      start: 0,
      end: 10,
      text: "Kitni bribe hai?",
      words: [
        { start: 1, end: 2, text: " kitni" },
        { start: 2, end: 3, text: " bribe" },
        { start: 3, end: 4, text: " hai?" },
      ],
    });
    expect(words.map((w) => [w.start, w.end])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
  });

  it("skips a timing token that isn't a rendered word", () => {
    // A danda comes back as its own token often enough to matter; pairing by
    // position would put every word after it one timing late.
    const words = captionWords({
      start: 0,
      end: 10,
      text: "आप प्लेट सेवा",
      words: [
        { start: 1, end: 2, text: "आप" },
        { start: 2, end: 3, text: "प्लेट" },
        { start: 3, end: 4, text: "।" },
        { start: 4, end: 5, text: "सेवा" },
      ],
    });
    expect(words.map((w) => w.start)).toEqual([1, 2, 4]);
  });

  it("never pairs a word with a timing already used by an earlier word", () => {
    // "the" appears twice. Matching must walk forwards, so the second "the"
    // takes the second timing rather than re-taking the first.
    const words = captionWords({
      start: 0,
      end: 10,
      text: "the cat the dog",
      words: [
        { start: 0, end: 1, text: "the" },
        { start: 1, end: 2, text: "cat" },
        { start: 5, end: 6, text: "the" },
        { start: 6, end: 7, text: "dog" },
      ],
    });
    expect(words.map((w) => w.start)).toEqual([0, 1, 5, 6]);
  });

  it("never lets the fill run backwards on a timing that steps back", () => {
    const words = captionWords({
      start: 0,
      end: 10,
      text: "one two three",
      words: [
        { start: 4, end: 5, text: "one" },
        { start: 1, end: 2, text: "two" },
        { start: 6, end: 7, text: "three" },
      ],
    });
    for (let i = 1; i < words.length; i += 1) {
      expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].start);
    }
  });

  it("returns nothing for an empty or missing line", () => {
    expect(captionWords({ start: 0, end: 1, text: "   " })).toEqual([]);
    expect(
      captionWords({ start: 0, end: 1 } as Parameters<typeof captionWords>[0]),
    ).toEqual([]);
  });
});

describe("fillFraction", () => {
  const segment = { start: 10, end: 14, text: "aaa bbb ccc ddd" };

  it("is empty before the line starts", () => {
    expect(fillFraction(segment, 9.9)).toBe(0);
    expect(fillFraction(segment, 10)).toBe(0);
  });

  it("advances through the line as it is spoken", () => {
    expect(fillFraction(segment, 11)).toBeCloseTo(0.25);
    expect(fillFraction(segment, 12)).toBeCloseTo(0.5);
  });

  it("is full at the end and stays there", () => {
    expect(fillFraction(segment, 14)).toBe(1);
    expect(fillFraction(segment, 400)).toBe(1);
  });

  it("fills instantly for a zero-length segment rather than dividing by zero", () => {
    expect(fillFraction({ start: 10, end: 10, text: "hi there" }, 10.5)).toBe(1);
    expect(fillFraction({ start: 10, end: 10, text: "hi there" }, 9)).toBe(0);
  });

  it("survives a reversed segment from a malformed transcript", () => {
    expect(fillFraction({ start: 10, end: 4, text: "hi there" }, 11)).toBe(1);
  });
});

describe("fillingWordIndex", () => {
  // "a" (2) + "bb" (3) + "ccc" (4) of 9 characters: boundaries at 2/9 and 5/9.
  const words = captionWords({ start: 0, end: 9, text: "a bb ccc" });

  it("reports nothing filling before the line starts", () => {
    expect(fillingWordIndex(words, 0)).toBe(-1);
    expect(fillingWordIndex(words, -0.5)).toBe(-1);
  });

  it("points at the word the sweep is inside", () => {
    expect(fillingWordIndex(words, 0.1)).toBe(0);
    expect(fillingWordIndex(words, 0.4)).toBe(1);
    expect(fillingWordIndex(words, 0.8)).toBe(2);
  });

  it("moves on at a word boundary rather than lingering", () => {
    // Exactly on the end of "a" is the start of "bb" — which is also where a
    // pause parks the fill, so the next word must render as untouched rather
    // than the finished one keeping the gradient.
    expect(fillingWordIndex(words, 2 / 9)).toBe(1);
    expect(fillingWordIndex(words, 5 / 9)).toBe(2);
  });

  it("reports the line finished once the sweep is past the last word", () => {
    // Past the end, so no word carries the clip and every one is flat colour.
    expect(fillingWordIndex(words, 1)).toBe(words.length);
    expect(fillingWordIndex(words, 1.5)).toBe(words.length);
  });

  it("says nothing is filling on an empty line", () => {
    expect(fillingWordIndex([], 0.5)).toBe(0);
    expect(fillingWordIndex([], 0)).toBe(-1);
  });
});

describe("fillFraction (word-level)", () => {
  // Two words of equal length, each +1 trailing space => each owns half the line.
  // "hello" (0-1) ... gap ... "world" (2-3).
  const segment = {
    start: 0,
    end: 4,
    text: "hello world",
    words: [
      { start: 0, end: 1, text: "hello" },
      { start: 2, end: 3, text: "world" },
    ],
  };

  it("sits at the leading edge of the first word as it begins", () => {
    expect(fillFraction(segment, 0)).toBeCloseTo(0);
  });

  it("eases across the first word's slice while it is spoken", () => {
    expect(fillFraction(segment, 0.5)).toBeCloseTo(0.25);
    expect(fillFraction(segment, 1)).toBeCloseTo(0.5);
  });

  it("HOLDS during the gap between words instead of racing ahead", () => {
    // Between t=1 (end of "hello") and t=2 (start of "world") nothing is being
    // said, so the fill must stay pinned at the end of "hello".
    expect(fillFraction(segment, 1.2)).toBeCloseTo(0.5);
    expect(fillFraction(segment, 1.999)).toBeCloseTo(0.5);
  });

  it("steps to the next word's slice only when that word starts", () => {
    expect(fillFraction(segment, 2)).toBeCloseTo(0.5);
    expect(fillFraction(segment, 2.5)).toBeCloseTo(0.75);
    expect(fillFraction(segment, 3)).toBeCloseTo(1);
  });

  it("never leaves the word being spoken", () => {
    // The point of the whole exercise: while a word is mid-utterance the fill
    // stays inside that word's own slice and cannot bleed onto the next one.
    const words = captionWords(segment);
    for (let t = 0; t <= 1; t += 0.05) {
      const fill = fillFraction(segment, t);
      expect(fill).toBeGreaterThanOrEqual(words[0].from);
      expect(fill).toBeLessThanOrEqual(words[0].to + 1e-9);
    }
  });

  it("is full and stays full after the last word ends", () => {
    expect(fillFraction(segment, 3.5)).toBe(1);
    expect(fillFraction(segment, 999)).toBe(1);
  });

  it("is empty before the segment starts, even with words present", () => {
    const early = {
      start: 10,
      end: 20,
      text: "hi",
      words: [{ start: 10, end: 11, text: "hi" }],
    };
    expect(fillFraction(early, 9)).toBe(0);
    expect(fillFraction(early, 10)).toBe(0);
  });

  it("treats an instantaneous word as fully spoken once it starts", () => {
    const seg = {
      start: 0,
      end: 2,
      text: "boom ok",
      words: [
        { start: 0, end: 0, text: "boom" },
        { start: 1, end: 2, text: "ok" },
      ],
    };
    // "boom" (4 chars + space = 5) of 8 total, spoken in full once reached.
    expect(fillFraction(seg, 0.5)).toBeCloseTo(5 / 8);
  });
});

describe("centreOffset", () => {
  // Ten 100px rows in a 300px viewport: 1000px of content, 700px of travel.
  const tops = Array.from({ length: 10 }, (_, i) => i * 100);
  const total = 1000;

  it("parks a mid-list row on the anchor", () => {
    // Row 5 spans 500-600, so its centre is 550. The anchor is 41% of a 300px
    // viewport, or 123px down, so the list sits at 550 - 123 - 50 = 427.
    expect(centreOffset(tops, total, 5, 300, 100)).toBeCloseTo(-427);
  });

  it("puts the spoken line above the middle, not on it", () => {
    // The whole point of the anchor: more room below the line than above it.
    const anchored = centreOffset(tops, total, 5, 300, 100);
    const centred = centreOffset(tops, total, 5, 300, 100, 0.5);
    expect(anchored).toBeLessThan(centred);
  });

  it("honours an explicit anchor", () => {
    expect(centreOffset(tops, total, 5, 300, 100, 0.5)).toBe(-400);
  });

  it("never scrolls above the first line", () => {
    expect(centreOffset(tops, total, 0, 300, 100)).toBe(0);
    // Row 1 wants to sit 27px down rather than flush, which is still a list
    // scrolled forwards — what must never happen is a positive offset.
    expect(centreOffset(tops, total, 1, 300, 100)).toBeCloseTo(-27);
  });

  it("never scrolls past the last line", () => {
    expect(centreOffset(tops, total, 9, 300, 100)).toBe(-700);
  });

  it("stays put when the content is shorter than the viewport", () => {
    expect(centreOffset([0, 100], 200, 1, 800, 100)).toBe(0);
  });

  it("treats an unknown index as the top", () => {
    expect(centreOffset(tops, total, 99, 300, 100)).toBe(0);
  });
});

describe("clampOffset", () => {
  it("refuses to drag past either end", () => {
    expect(clampOffset(200, 1000, 300)).toBe(0);
    expect(clampOffset(-9000, 1000, 300)).toBe(-700);
  });

  it("passes through a value already in range", () => {
    expect(clampOffset(-250, 1000, 300)).toBe(-250);
  });

  it("pins a short transcript to the top", () => {
    expect(clampOffset(-50, 200, 800)).toBe(0);
  });
});

describe("isRowVisible", () => {
  const tops = Array.from({ length: 10 }, (_, i) => i * 100);

  it("sees a row inside the window", () => {
    expect(isRowVisible(tops, 5, -400, 300)).toBe(true);
  });

  it("does not see a row scrolled well past", () => {
    expect(isRowVisible(tops, 0, -900, 300)).toBe(false);
  });

  it("does not see a row far below the fold", () => {
    expect(isRowVisible(tops, 9, 0, 300)).toBe(false);
  });

  it("allows a little slack above, so a part-scrolled line still counts", () => {
    // Row 4 top is 400, viewport starts at 420 — 20px clipped is still "in view".
    expect(isRowVisible(tops, 4, -420, 300)).toBe(true);
  });

  it("reports an unknown index as not visible", () => {
    expect(isRowVisible(tops, 99, 0, 300)).toBe(false);
  });
});
