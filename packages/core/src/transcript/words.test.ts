import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@cue/types';
import { gapBefore, GAP_MS, segmentWords, wordProgress } from './words.ts';

function segment(partial: Partial<TranscriptSegment>): TranscriptSegment {
  return { index: 0, startMs: 0, endMs: 1000, text: 'one two', speaker: null, ...partial };
}

describe('segmentWords without measured timings', () => {
  /**
   * The deliberate limitation. A publisher caption file is cue-level by format
   * — WebVTT and SRT have nowhere to record when each word was said — so there
   * is nothing here to sweep with, and saying so is the whole point.
   *
   * An earlier version estimated word spans by weighting characters. It read
   * convincingly and was worse than nothing: the highlight advanced at a
   * constant rate through speech that does not, so it spent most of a sentence
   * sitting on the wrong word while looking precise about it. Null sends the
   * caller to a line-level highlight, which says less and is never wrong.
   */
  it('reports null for a cue with no word list', () => {
    expect(segmentWords(segment({ text: 'a publisher caption line' }))).toBeNull();
  });

  it('reports null for an empty word list', () => {
    expect(segmentWords(segment({ text: 'a b c', words: [] }))).toBeNull();
    expect(segmentWords(segment({ text: 'a b c', words: null }))).toBeNull();
  });

  it('reports null rather than guessing, however long the cue', () => {
    // The case the estimator existed for: plenty of time, plenty of text, and
    // no information whatsoever about where within it each word falls.
    expect(
      segmentWords(segment({ startMs: 0, endMs: 14_420, text: 'A sentence, then silence.' })),
    ).toBeNull();
  });
});

describe('segmentWords with measured timings', () => {
  const measured = segment({
    startMs: 1000,
    endMs: 2400,
    text: 'one twelve three',
    words: [
      { startMs: 1000, endMs: 1400, text: 'one' },
      { startMs: 1400, endMs: 2000, text: 'twelve' },
      { startMs: 2000, endMs: 2400, text: 'three' },
    ],
  });

  it('uses them verbatim rather than reshaping them', () => {
    expect(segmentWords(measured)!.map((w) => [w.text, w.startMs, w.endMs])).toEqual([
      ['one', 1000, 1400],
      ['twelve', 1400, 2000],
      ['three', 2000, 2400],
    ]);
  });

  it('keeps spans no model would have guessed', () => {
    // "one" and "three" are both said in 400ms despite differing in length.
    const [one, , three] = segmentWords(measured)!;
    expect(one!.endMs - one!.startMs).toBe(400);
    expect(three!.endMs - three!.startMs).toBe(400);
  });

  /**
   * Whisper reports no silence — it hands the silence to the preceding word.
   * Measured on a real episode, every one of 5,853 word transitions was
   * contiguous, and "And" was held for 1,640ms. Sweeping a three-letter word
   * for that long is the "it runs straight through the pause" complaint.
   */
  it('does not sweep a short word across a long silence', () => {
    const held = segment({
      startMs: 0,
      endMs: 2000,
      text: 'And so',
      words: [
        { startMs: 0, endMs: 1640, text: 'And' },
        { startMs: 1640, endMs: 2000, text: 'so' },
      ],
    });

    const [and, so] = segmentWords(held)!;
    // The start is Whisper's and is trusted...
    expect(and!.startMs).toBe(0);
    // ...but the fill completes at a speaking pace rather than creeping across
    // the silence: well under a third of the 1,640ms it was handed.
    expect(and!.endMs - and!.startMs).toBeLessThan(600);
    // The remainder is now a real gap: nothing is lit until "so" begins.
    expect(so!.startMs).toBe(1640);
    expect(and!.endMs).toBeLessThan(so!.startMs);
  });

  it('leaves a word that genuinely takes its time alone', () => {
    const slow = segment({
      startMs: 0,
      endMs: 1200,
      text: 'incomprehensibly',
      words: [{ startMs: 0, endMs: 1200, text: 'incomprehensibly' }],
    });
    // 16 characters at the cap's pace is over 1.3s, so nothing is trimmed.
    expect(segmentWords(slow)![0]!.endMs).toBe(1200);
  });

  it('reports null when the words no longer spell the line', () => {
    // The visible symptom this prevents: the active line is rendered from these
    // pieces and every other line from `text`, so a missing word makes the line
    // lose a word exactly as the highlight lands on it.
    const missing = segment({
      startMs: 0,
      endMs: 3000,
      text: 'one two three',
      words: [
        { startMs: 0, endMs: 900, text: 'one' },
        { startMs: 900, endMs: 1800, text: 'three' },
      ],
    });
    expect(segmentWords(missing)).toBeNull();
  });

  it('accepts words that differ from the line only in spacing', () => {
    const spaced = segment({
      startMs: 0,
      endMs: 2000,
      text: '  Hello,   world!  ',
      words: [
        { startMs: 0, endMs: 900, text: 'Hello,' },
        { startMs: 900, endMs: 2000, text: 'world!' },
      ],
    });
    expect(segmentWords(spaced)!.map((w) => w.text)).toEqual(['Hello,', 'world!']);
  });

  it('reports null for a word list that cannot spell the line at all', () => {
    const corrupt = segment({
      startMs: 0,
      endMs: 2000,
      text: 'a b',
      words: [{ startMs: 500, endMs: 500, text: 'a' }],
    });
    // These words do not spell the line, so they are not this line's words.
    expect(segmentWords(corrupt)).toBeNull();
  });

  it('keeps a zero-span word rather than dropping it off the screen', () => {
    // Whisper rounds to a 20ms grid, so a quick word can start and end on the
    // same millisecond. Dropping it would take the word out of the line.
    const instant = segment({
      startMs: 0,
      endMs: 3000,
      text: 'x y',
      words: [
        { startMs: 100, endMs: 100, text: 'x' },
        { startMs: 100, endMs: 900, text: 'y' },
      ],
    });
    expect(segmentWords(instant)!.map((w) => w.text)).toEqual(['x', 'y']);
    expect(segmentWords(instant)!.map((w) => w.index)).toEqual([0, 1]);
  });
});

describe('wordProgress', () => {
  const word = { index: 0, text: 'hello', startMs: 1000, endMs: 2000 };

  it('runs 0 → 1 across the word', () => {
    expect(wordProgress(word, 1000)).toBe(0);
    expect(wordProgress(word, 1500)).toBeCloseTo(0.5);
    expect(wordProgress(word, 2000)).toBe(1);
  });

  it('clamps outside it, so callers need no bounds check', () => {
    expect(wordProgress(word, 0)).toBe(0);
    expect(wordProgress(word, 99_999)).toBe(1);
  });

  it('treats a zero-length word as a step, not a divide by zero', () => {
    const instant = { index: 0, text: 'a', startMs: 500, endMs: 500 };
    expect(wordProgress(instant, 499)).toBe(0);
    expect(wordProgress(instant, 500)).toBe(1);
  });
});

describe('gapBefore', () => {
  const segments: TranscriptSegment[] = [
    segment({ index: 0, startMs: 30_000, endMs: 32_000 }),
    segment({ index: 1, startMs: 32_500, endMs: 34_000 }),
    segment({ index: 2, startMs: 50_000, endMs: 52_000 }),
  ];

  it('reports the silence before the first line as running from zero', () => {
    expect(gapBefore(segments, 0)).toEqual({ startMs: 0, endMs: 30_000 });
  });

  it('ignores the ordinary rhythm of speech', () => {
    expect(gapBefore(segments, 1)).toBeNull();
  });

  it('reports a real break', () => {
    expect(gapBefore(segments, 2)).toEqual({ startMs: 34_000, endMs: 50_000 });
  });

  it('treats the threshold as inclusive', () => {
    const at = (gap: number): TranscriptSegment[] => [
      segment({ index: 0, startMs: 0, endMs: 1000 }),
      segment({ index: 1, startMs: 1000 + gap, endMs: 9000 }),
    ];

    expect(gapBefore(at(GAP_MS), 1)).toEqual({ startMs: 1000, endMs: 1000 + GAP_MS });
    expect(gapBefore(at(GAP_MS - 1), 1)).toBeNull();
  });

  it('is null for an index that is not there', () => {
    expect(gapBefore(segments, 99)).toBeNull();
  });
});
