import type { StoredSegment } from '@cue/db';
import { describe, expect, it } from 'vitest';
import { buildAskMessages, citationsFrom } from './ask.ts';
import { normaliseChapters } from './generate.ts';
import { shift } from './transcribe.ts';

const segments: StoredSegment[] = [
  { index: 0, startMs: 0, endMs: 4000, text: 'Welcome to the show.', speaker: null },
  { index: 1, startMs: 4000, endMs: 9000, text: 'Revenue grew 40% last quarter.', speaker: null },
  { index: 2, startMs: 9000, endMs: 15_000, text: 'We hired thirty people.', speaker: null },
];

describe('citationsFrom', () => {
  it('resolves a citation to its transcript line', () => {
    const found = citationsFrom('Revenue was up sharply [1].', segments);
    expect(found).toEqual([
      { segmentIndex: 1, startMs: 4000, text: 'Revenue grew 40% last quarter.' },
    ]);
  });

  it('resolves several citations on one claim', () => {
    expect(citationsFrom('They grew and hired [1][2].', segments).map((c) => c.segmentIndex)).toEqual([
      1, 2,
    ]);
  });

  it('drops an index the model invented rather than clamping it', () => {
    // Clamping would point the reader at a real line that says something else,
    // which looks like evidence. A missing citation is honest; a wrong one is not.
    expect(citationsFrom('As they said [99].', segments)).toEqual([]);
  });

  it('keeps the valid citations from an answer that also invents one', () => {
    const found = citationsFrom('Revenue grew [1] and headcount doubled [42].', segments);
    expect(found.map((c) => c.segmentIndex)).toEqual([1]);
  });

  it('reports each line once even when cited repeatedly', () => {
    expect(citationsFrom('[1] and again [1] and once more [1].', segments)).toHaveLength(1);
  });

  it('returns citations in transcript order, not the order they were written', () => {
    // The answer may mention the conclusion before the setup; the citation list
    // is navigation, and navigation should run forwards.
    expect(citationsFrom('Later [2], but earlier [0].', segments).map((c) => c.startMs)).toEqual([
      0, 9000,
    ]);
  });

  it('ignores bracketed text that is not a citation', () => {
    expect(citationsFrom('They said [inaudible] and [something else].', segments)).toEqual([]);
  });

  it('returns nothing for an answer with no citations', () => {
    expect(citationsFrom('The transcript does not cover that.', segments)).toEqual([]);
  });
});

describe('buildAskMessages', () => {
  it('numbers every line so the model has something to point at', () => {
    const [, user] = buildAskMessages(segments, 'What grew?', 'en');
    expect(user!.content).toContain('[1] (0:04) Revenue grew 40% last quarter.');
  });

  it('carries the question', () => {
    const [, user] = buildAskMessages(segments, 'How many were hired?', 'en');
    expect(user!.content).toContain('Question: How many were hired?');
  });

  it('forbids answering from outside the transcript', () => {
    const [system] = buildAskMessages(segments, 'x', 'en');
    expect(system!.content).toContain('ONLY');
    expect(system!.content).toMatch(/do not guess/i);
  });
});

describe('normaliseChapters', () => {
  it('sorts, fills end times, and anchors the first chapter at zero', () => {
    const chapters = normaliseChapters(
      [
        { startMs: 60_000, title: 'The middle' },
        { startMs: 12_000, title: 'The opening' },
      ],
      120_000,
    );

    expect(chapters.map((c) => [c.startMs, c.endMs, c.title])).toEqual([
      // A list that begins at 0:12 leaves the opening unreachable by the only
      // navigation on offer, so the first entry is pulled back to zero.
      [0, 60_000, 'The opening'],
      [60_000, 120_000, 'The middle'],
    ]);
  });

  it('drops a chapter past the end of the episode', () => {
    // A tap on this would seek beyond the audio and stall the player.
    const chapters = normaliseChapters(
      [
        { startMs: 0, title: 'Real' },
        { startMs: 9_000_000, title: 'Hallucinated' },
      ],
      120_000,
    );
    expect(chapters.map((c) => c.title)).toEqual(['Real']);
  });

  it('accepts seconds when the model returns those instead', () => {
    // Models produce both no matter which is asked for, and a chapter list is
    // not worth discarding over the unit it arrived in.
    const chapters = normaliseChapters(
      [
        { startSec: 0, title: 'One' },
        { startSec: 90, title: 'Two' },
      ],
      300_000,
    );
    expect(chapters.map((c) => c.startMs)).toEqual([0, 90_000]);
  });

  it('collapses duplicate timestamps', () => {
    const chapters = normaliseChapters(
      [
        { startMs: 0, title: 'First' },
        { startMs: 30_000, title: 'Second' },
        { startMs: 30_000, title: 'Also second' },
      ],
      60_000,
    );
    expect(chapters).toHaveLength(2);
  });

  it('caps a runaway list', () => {
    const raw = Array.from({ length: 40 }, (_, i) => ({ startMs: i * 1000, title: `Chapter ${i}` }));
    expect(normaliseChapters(raw, 100_000)).toHaveLength(12);
  });

  it('drops entries with an empty title', () => {
    const chapters = normaliseChapters(
      [
        { startMs: 0, title: 'Kept' },
        { startMs: 5000, title: '   ' },
      ],
      10_000,
    );
    expect(chapters).toHaveLength(1);
  });

  it('returns nothing when every entry is unusable', () => {
    expect(normaliseChapters([{ startMs: 999_999, title: 'Past the end' }], 1000)).toEqual([]);
  });

  it('leaves chapters contiguous, so every moment belongs to one', () => {
    const chapters = normaliseChapters(
      [
        { startMs: 0, title: 'A' },
        { startMs: 20_000, title: 'B' },
        { startMs: 50_000, title: 'C' },
      ],
      90_000,
    );

    for (let i = 0; i < chapters.length - 1; i += 1) {
      expect(chapters[i]!.endMs).toBe(chapters[i + 1]!.startMs);
    }
    expect(chapters.at(-1)!.endMs).toBe(90_000);
  });
});

describe('shift', () => {
  it('moves a chunk’s cues into episode time', () => {
    // Whisper times every upload from zero. Without this, every chunk after the
    // first claims to start at the beginning of the episode.
    expect(shift([{ startMs: 0, endMs: 3000, text: 'hello' }], 600_000)).toEqual([
      { startMs: 600_000, endMs: 603_000, text: 'hello' },
    ]);
  });

  it('leaves the first chunk alone', () => {
    const segments = [{ startMs: 10, endMs: 20, text: 'x' }];
    expect(shift(segments, 0)).toBe(segments);
  });

  it('does not invent a span for an untimed fallback segment', () => {
    // A zero end means the chunk came back with no segment boundaries at all;
    // shifting it would fabricate a measurement that was never made.
    expect(shift([{ startMs: 0, endMs: 0, text: 'x' }], 5000)).toEqual([
      { startMs: 5000, endMs: 0, text: 'x' },
    ]);
  });
});
