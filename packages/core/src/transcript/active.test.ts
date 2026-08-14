import type { TranscriptSegment } from '@cue/types';
import { describe, expect, it } from 'vitest';
import { activeSegmentIndex, searchSegments, seekTargetSec, SEEK_LEAD_MS } from './active.ts';

const segment = (index: number, startMs: number, endMs: number, text = `line ${index}`): TranscriptSegment => ({
  index,
  startMs,
  endMs,
  text,
  speaker: null,
});

/** A cue, a gap, a cue — the shape every real caption file has. */
const SEGMENTS = [
  segment(0, 1000, 3000),
  segment(1, 3000, 5000),
  segment(2, 9000, 11_000),
];

describe('activeSegmentIndex', () => {
  it('finds the line covering the playhead', () => {
    expect(activeSegmentIndex(SEGMENTS, 4000)).toBe(1);
  });

  it('is inclusive of a cue start, so the line lights the instant it begins', () => {
    expect(activeSegmentIndex(SEGMENTS, 3000)).toBe(1);
  });

  it('reports nothing before the first cue', () => {
    // Cold opens and music beds are real: highlighting line one through 30
    // seconds of theme tune is worse than highlighting nothing.
    expect(activeSegmentIndex(SEGMENTS, 0)).toBe(-1);
    expect(activeSegmentIndex(SEGMENTS, 999)).toBe(-1);
  });

  it('holds the previous line through a silent gap', () => {
    // 5s–9s is silence. Blanking the highlight there makes the transcript
    // flicker off between every sentence, which reads as a bug.
    expect(activeSegmentIndex(SEGMENTS, 7000)).toBe(1);
  });

  it('holds the last line past the end of the transcript', () => {
    expect(activeSegmentIndex(SEGMENTS, 999_999)).toBe(2);
  });

  it('handles an empty transcript without throwing', () => {
    expect(activeSegmentIndex([], 1234)).toBe(-1);
  });

  it('agrees with a linear scan across a large transcript', () => {
    // The property that matters: the binary search must not disagree with the
    // obvious implementation anywhere, including on cue boundaries.
    const many = Array.from({ length: 2000 }, (_, i) => segment(i, i * 3000, i * 3000 + 2500));

    const linear = (positionMs: number) => {
      let last = -1;
      for (const s of many) if (s.startMs <= positionMs) last = s.index;
      return last;
    };

    for (const position of [0, 1, 2999, 3000, 3001, 1_500_000, 5_997_000, 9_999_999]) {
      expect(activeSegmentIndex(many, position)).toBe(linear(position));
    }
  });
});

describe('seekTargetSec', () => {
  it('seeks slightly before the cue so the first consonant is not clipped', () => {
    expect(seekTargetSec(segment(0, 10_000, 12_000))).toBeCloseTo((10_000 - SEEK_LEAD_MS) / 1000);
  });

  it('never seeks before the start of the episode', () => {
    expect(seekTargetSec(segment(0, 50, 900))).toBe(0);
  });
});

describe('searchSegments', () => {
  const lines = [
    segment(0, 0, 1000, 'The economy is complicated'),
    segment(1, 1000, 2000, 'Inflation in Argentina'),
    segment(2, 2000, 3000, 'inflation again, lower case'),
  ];

  it('matches regardless of case', () => {
    expect(searchSegments(lines, 'INFLATION').map((s) => s.index)).toEqual([1, 2]);
  });

  it('matches a phrase across words', () => {
    expect(searchSegments(lines, 'in Argentina').map((s) => s.index)).toEqual([1]);
  });

  it('returns nothing for a blank query rather than every line', () => {
    expect(searchSegments(lines, '   ')).toEqual([]);
  });
});
