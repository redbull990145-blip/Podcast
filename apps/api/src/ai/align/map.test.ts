/**
 * The staircase, and the cases where there should not be one.
 *
 * Roughly half of these assert a refusal. That ratio is the point: the failure
 * this code exists to fix is already survivable — the reader sees captions that
 * lag and a nudge control to fix them — so a map that is confidently wrong is a
 * worse outcome than no map, and the tests weight accordingly.
 */

import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@cue/types';
import {
  applyOffsetMap,
  buildOffsetMap,
  offsetAt,
  toAudioMs,
  type Anchor,
} from './map.ts';

/** An anchor that matched well, unless told otherwise. */
function anchor(transcriptMs: number, offsetMs: number, similarity = 0.9): Anchor {
  return { transcriptMs, audioMs: transcriptMs + offsetMs, similarity };
}

function segment(startMs: number, endMs: number, text = 'x'): TranscriptSegment {
  return { index: 0, startMs, endMs, text, speaker: null };
}

describe('buildOffsetMap', () => {
  it('reads a single pre-roll as one flat tread', () => {
    // The measured Elevation case: 8.7s of ad at the front and nothing after.
    const map = buildOffsetMap([
      anchor(1_300, 8_693),
      anchor(1_801_300, 8_693),
      anchor(2_901_300, 8_693),
    ]);

    expect(map).not.toBeNull();
    expect(map!.steps).toHaveLength(1);
    expect(map!.steps[0]).toMatchObject({ fromTranscriptMs: 0, offsetMs: 8_693 });
  });

  it('puts a step between the two anchors that disagreed', () => {
    const map = buildOffsetMap([
      anchor(60_000, 9_000),
      anchor(600_000, 9_000),
      anchor(1_200_000, 69_000),
      anchor(1_800_000, 69_000),
    ])!;

    expect(map.steps).toHaveLength(2);
    expect(map.steps[1]!.offsetMs).toBe(69_000);
    // Midway between the last anchor still at 9s and the first at 69s, with the
    // bracket recording how wide that estimate really is.
    expect(map.steps[1]!.fromTranscriptMs).toBe(900_000);
    expect(map.steps[1]!.bracketMs).toEqual([600_000, 1_200_000]);
  });

  it('handles three breaks without merging them', () => {
    const map = buildOffsetMap([
      anchor(30_000, 5_000),
      anchor(500_000, 65_000),
      anchor(1_000_000, 125_000),
      anchor(1_500_000, 185_000),
    ])!;

    expect(map.steps.map((s) => s.offsetMs)).toEqual([5_000, 65_000, 125_000, 185_000]);
  });

  it('treats sub-second disagreement as one tread, not four', () => {
    // Anchors on the same tread disagree by a little, because a cue-level match
    // cannot be more precise than a cue.
    const map = buildOffsetMap([
      anchor(30_000, 8_400),
      anchor(600_000, 9_100),
      anchor(1_200_000, 8_700),
      anchor(1_800_000, 9_000),
    ])!;

    expect(map.steps).toHaveLength(1);
    expect(map.steps[0]!.offsetMs).toBeGreaterThan(8_300);
    expect(map.steps[0]!.offsetMs).toBeLessThan(9_200);
  });

  it('refuses anchors that imply audio arriving early', () => {
    // Inserted audio can only push a cue later. A set that says otherwise is
    // describing a bad text match, not an ad break.
    expect(
      buildOffsetMap([anchor(60_000, 9_000), anchor(600_000, 9_000), anchor(1_200_000, 2_000)]),
    ).toBeNull();
  });

  it('catches a regression that no adjacent pair reveals', () => {
    // 9s, 9s, 4s: each neighbouring pair moves by little enough to look like
    // two small steps, and the set as a whole is still a contradiction.
    expect(
      buildOffsetMap([
        anchor(0, 9_000),
        anchor(500_000, 7_600),
        anchor(1_000_000, 6_200),
        anchor(1_500_000, 4_800),
      ]),
    ).toBeNull();
  });

  it('discards weak matches before fitting anything', () => {
    const map = buildOffsetMap([
      anchor(60_000, 9_000),
      anchor(600_000, 400_000, 0.2), // nonsense, and low-confidence about it
      anchor(1_200_000, 9_000),
    ])!;

    expect(map.anchors).toHaveLength(2);
    expect(map.steps).toHaveLength(1);
    expect(map.steps[0]!.offsetMs).toBe(9_000);
  });

  it('refuses when too few anchors survive to describe a timeline', () => {
    expect(buildOffsetMap([anchor(60_000, 9_000)])).toBeNull();
    expect(buildOffsetMap([])).toBeNull();
    expect(
      buildOffsetMap([anchor(60_000, 9_000, 0.1), anchor(600_000, 9_000, 0.2)]),
    ).toBeNull();
  });

  it('takes the median of a tread so one bad anchor cannot drag it', () => {
    const map = buildOffsetMap([
      anchor(0, 9_000),
      anchor(300_000, 9_100),
      anchor(600_000, 9_050),
    ])!;

    expect(map.steps[0]!.offsetMs).toBe(9_050);
  });

  it('reports confidence as the mean of what it used', () => {
    const map = buildOffsetMap([anchor(0, 9_000, 0.8), anchor(600_000, 9_000, 1.0)])!;
    expect(map.confidence).toBeCloseTo(0.9, 5);
  });
});

describe('offsetAt', () => {
  const map = buildOffsetMap([
    anchor(60_000, 9_000),
    anchor(600_000, 9_000),
    anchor(1_200_000, 69_000),
    anchor(1_800_000, 69_000),
  ])!;

  it('holds the earlier tread right up to the boundary', () => {
    expect(offsetAt(map, 0)).toBe(9_000);
    expect(offsetAt(map, 899_999)).toBe(9_000);
  });

  it('switches at the boundary and stays there', () => {
    expect(offsetAt(map, 900_000)).toBe(69_000);
    expect(offsetAt(map, 5_000_000)).toBe(69_000);
  });

  it('maps a transcript time onto the served audio', () => {
    expect(toAudioMs(map, 60_000)).toBe(69_000);
    expect(toAudioMs(map, 1_200_000)).toBe(1_269_000);
  });
});

describe('applyOffsetMap', () => {
  const map = buildOffsetMap([
    anchor(60_000, 9_000),
    anchor(600_000, 9_000),
    anchor(1_200_000, 69_000),
    anchor(1_800_000, 69_000),
  ])!;

  it('shifts cues by the tread they fall on', () => {
    const [early, late] = applyOffsetMap([segment(10_000, 12_000), segment(1_000_000, 1_002_000)], map);

    expect(early).toMatchObject({ startMs: 19_000, endMs: 21_000 });
    expect(late).toMatchObject({ startMs: 1_069_000, endMs: 1_071_000 });
  });

  it('stretches the one cue that straddles the break, leaving a gap after it', () => {
    // 899s to 901s in transcript time — the ad lands inside it. The cue is
    // rendered as running across the interruption, which is what happened, and
    // the following cue inherits a 60s gap that `gapBefore` draws as silence.
    const [straddling] = applyOffsetMap([segment(899_000, 901_000)], map);

    expect(straddling!.startMs).toBe(908_000);
    expect(straddling!.endMs).toBe(970_000);
  });

  it('re-times word timings alongside their cue', () => {
    const withWords: TranscriptSegment = {
      ...segment(10_000, 12_000),
      words: [
        { startMs: 10_000, endMs: 10_500, text: 'hello ' },
        { startMs: 10_500, endMs: 12_000, text: 'there' },
      ],
    };

    const [mapped] = applyOffsetMap([withWords], map);
    expect(mapped!.words).toEqual([
      { startMs: 19_000, endMs: 19_500, text: 'hello ' },
      { startMs: 19_500, endMs: 21_000, text: 'there' },
    ]);
  });

  it('leaves a cue without words without a words key', () => {
    const [mapped] = applyOffsetMap([segment(10_000, 12_000)], map);
    expect(mapped).not.toHaveProperty('words');
  });

  it('never produces a cue that ends before it starts', () => {
    const negative = buildOffsetMap([anchor(0, -5_000), anchor(600_000, -5_000)])!;
    const [mapped] = applyOffsetMap([segment(1_000, 2_000)], negative);

    expect(mapped!.startMs).toBe(0);
    expect(mapped!.endMs).toBeGreaterThanOrEqual(mapped!.startMs);
  });

  it('keeps cues in ascending order, which the binary search depends on', () => {
    const mapped = applyOffsetMap(
      [segment(0, 1_000), segment(500_000, 501_000), segment(1_500_000, 1_501_000)],
      map,
    );

    for (let i = 1; i < mapped.length; i += 1) {
      expect(mapped[i]!.startMs).toBeGreaterThanOrEqual(mapped[i - 1]!.startMs);
    }
  });
});
