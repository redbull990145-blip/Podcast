import { describe, expect, it } from "vitest";
import { captionWords, fillFraction, fillingWordIndex } from "./caption-motion";
import type { TranscriptSegment } from "@/lib/db/schema";

/**
 * Word-level alignment, which is where the residual desynchronisation lived.
 *
 * A line is only as synchronised as the pairing between the tokens on screen
 * and the timings the provider returned for them. Every case below is a way
 * that pairing has actually gone wrong, expressed as the thing a listener would
 * see: the highlight sitting on a word other than the one being said.
 */

const seg = (
  start: number,
  end: number,
  text: string,
  words?: { start: number; end: number; text: string }[],
): TranscriptSegment => ({ start, end, text, ...(words ? { words } : {}) });

/** Which word the highlight is on at `time`. */
function highlighted(segment: TranscriptSegment, time: number): string | null {
  const words = captionWords(segment);
  const index = fillingWordIndex(words, fillFraction(segment, time));
  return words[index]?.text ?? null;
}

describe("word anchoring", () => {
  it("prefers an exact match over a nearer prefix match", () => {
    /*
     * The regression this file was written for. Whisper emits a spurious
     * "there" before the real "the"; the prefix rule accepts "the" ≈ "there"
     * at the nearer position, consumes the cursor past the real timing, and
     * every following word on the line inherits the shift.
     */
    const segment = seg(0, 10, "the answer", [
      { start: 0, end: 4, text: "there" },
      { start: 4, end: 6, text: "the" },
      { start: 6, end: 10, text: "answer" },
    ]);

    const words = captionWords(segment);

    expect(words[0].text).toBe("the");
    expect(words[0].start).toBe(4);
    expect(words[1].text).toBe("answer");
    expect(words[1].start).toBe(6);
  });

  it.each([
    ["the", "there"],
    ["our", "ours"],
    ["her", "here"],
    ["one", "ones"],
    ["for", "form"],
    ["and", "android"],
  ])("does not let %s claim the timing belonging to %s", (short, long) => {
    const segment = seg(0, 9, `${short} word`, [
      { start: 0, end: 3, text: long },
      { start: 3, end: 6, text: short },
      { start: 6, end: 9, text: "word" },
    ]);

    expect(captionWords(segment)[0].start).toBe(3);
  });

  it("still matches a clipped suffix when nothing matches exactly", () => {
    // The case the fuzzy rule exists for: the provider split the contraction.
    const segment = seg(0, 6, "don't stop", [
      { start: 0, end: 3, text: "don" },
      { start: 3, end: 6, text: "stop" },
    ]);

    expect(captionWords(segment)[0].start).toBe(0);
    expect(captionWords(segment)[0].end).toBe(3);
  });

  it("leaves an unmatched token to interpolation rather than mis-anchoring it", () => {
    const segment = seg(0, 9, "alpha bravo charlie", [
      { start: 0, end: 3, text: "alpha" },
      { start: 6, end: 9, text: "charlie" },
    ]);

    const words = captionWords(segment);

    expect(words[0].start).toBe(0);
    // "bravo" has no timing; it borrows the gap between its neighbours.
    expect(words[1].start).toBeGreaterThanOrEqual(3);
    expect(words[1].end).toBeLessThanOrEqual(6);
    expect(words[2].start).toBe(6);
  });

  it("never lets anchors run backwards", () => {
    // A provider timing that steps back would make the fill jump up the line.
    const segment = seg(0, 10, "one two three", [
      { start: 6, end: 8, text: "one" },
      { start: 2, end: 4, text: "two" },
      { start: 8, end: 10, text: "three" },
    ]);

    const words = captionWords(segment);
    for (let i = 1; i < words.length; i += 1) {
      expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].start);
    }
  });

  it("matches across punctuation and case, which providers disagree on", () => {
    const segment = seg(0, 6, "Hai? Nahi", [
      { start: 0, end: 3, text: " hai" },
      { start: 3, end: 6, text: "Nahi." },
    ]);

    const words = captionWords(segment);
    expect(words[0].start).toBe(0);
    expect(words[1].start).toBe(3);
  });
});

describe("highlight position over time", () => {
  const segment = seg(10, 16, "alpha bravo charlie", [
    { start: 10, end: 12, text: "alpha" },
    { start: 12, end: 14, text: "bravo" },
    { start: 14, end: 16, text: "charlie" },
  ]);

  it("puts the highlight on the word actually being spoken", () => {
    expect(highlighted(segment, 11)).toBe("alpha");
    expect(highlighted(segment, 13)).toBe("bravo");
    expect(highlighted(segment, 15)).toBe("charlie");
  });

  it("holds the fill still through a pause instead of gliding on", () => {
    const paused = seg(0, 10, "before after", [
      { start: 0, end: 1, text: "before" },
      { start: 9, end: 10, text: "after" },
    ]);

    // Anywhere in the eight-second gap, the fill must sit exactly where the
    // speech stopped — not creep towards the next word.
    const atGapStart = fillFraction(paused, 1);
    expect(fillFraction(paused, 5)).toBe(atGapStart);
    expect(fillFraction(paused, 8.9)).toBe(atGapStart);
  });

  it("is empty before the line and full after it", () => {
    expect(fillFraction(segment, 9)).toBe(0);
    expect(fillFraction(segment, 16)).toBe(1);
    expect(fillFraction(segment, 1_000)).toBe(1);
  });

  it("is monotonic across the line, so the fill never runs backwards", () => {
    let previous = -1;
    for (let t = 9.5; t <= 16.5; t += 0.05) {
      const fill = fillFraction(segment, t);
      expect(fill).toBeGreaterThanOrEqual(previous);
      previous = fill;
    }
  });

  it("falls back to a proportional sweep when there are no word timings", () => {
    // A publisher transcript: per-line spans only.
    const bare = seg(0, 10, "one two three four");
    expect(fillFraction(bare, 0)).toBe(0);
    expect(fillFraction(bare, 10)).toBe(1);
    expect(fillFraction(bare, 5)).toBeGreaterThan(0);
    expect(fillFraction(bare, 5)).toBeLessThan(1);
  });
});
