import type { StoredSegment } from '@cue/db';
import { describe, expect, it } from 'vitest';
import { buildAskMessages, citationsFrom } from './ask.ts';
import { normaliseChapters } from './generate.ts';
import type { TranscribedSegment, TranscribedWord } from './groq.ts';
import { placeChunk } from './transcribe.ts';

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

describe('placeChunk', () => {
  /** A chunk running 10:00 → 20:00 of the episode. */
  const chunk = { startMs: 600_000, durationMs: 600_000 };

  /** A cue as the transcriber hands it over: chunk-local, usually wordless. */
  const cue = (
    startMs: number,
    endMs: number,
    text: string,
    words: TranscribedWord[] | null = null,
  ): TranscribedSegment => ({ startMs, endMs, text, words });

  it('moves a chunk’s cues into episode time', () => {
    // Whisper times every upload from zero. Without this, every chunk after the
    // first claims to start at the beginning of the episode.
    expect(placeChunk([cue(0, 3000, 'hello')], chunk)).toEqual([
      cue(600_000, 603_000, 'hello'),
    ]);
  });

  it('leaves the first chunk’s times alone', () => {
    expect(placeChunk([cue(10, 20, 'x')], { startMs: 0, durationMs: 600_000 })).toEqual([
      cue(10, 20, 'x'),
    ]);
  });

  /**
   * The regression that mattered. This used to shift the start and leave the
   * end at zero, producing a cue that ended ten minutes before it began.
   */
  it('gives an untimed fallback segment the chunk it was found in', () => {
    expect(placeChunk([cue(0, 0, 'x')], chunk)).toEqual([cue(600_000, 1_200_000, 'x')]);
  });

  it('never returns a cue that ends before it starts', () => {
    const placed = placeChunk(
      [cue(0, 0, 'no end'), cue(5000, 0, 'end omitted'), cue(1000, 2000, 'fine')],
      chunk,
    );
    for (const placedCue of placed) {
      expect(placedCue.endMs).toBeGreaterThanOrEqual(placedCue.startMs);
    }
  });

  /**
   * Whisper's documented behaviour on trailing silence is to run the final cue
   * of a chunk past the end of that chunk. Unclamped, it starts after the next
   * chunk's first cue and the concatenated array stops being sorted — which
   * breaks the binary search that picks the highlighted line.
   */
  it('clamps a cue that overruns the end of its chunk', () => {
    expect(placeChunk([cue(599_000, 640_000, 'tail')], chunk)).toEqual([
      cue(1_199_000, 1_200_000, 'tail'),
    ]);
  });

  it('drops a hallucinated cue that starts past the end of its chunk', () => {
    expect(placeChunk([cue(700_000, 701_000, 'ghost')], chunk)).toEqual([]);
  });

  it('clamps nothing when the chunk length was never measured', () => {
    // `durationMs: 0` is the single-piece fallback for audio that is not MP3
    // and so never went through frame-walking. Zero means "unknown", and
    // treating it as a real length would clamp every cue to the start.
    expect(placeChunk([cue(0, 9000, 'x')], { startMs: 0, durationMs: 0 })).toEqual([
      cue(0, 9000, 'x'),
    ]);
  });

  it('carries word timings into episode time with their cue', () => {
    const placed = placeChunk(
      [
        cue(1000, 3000, 'two words', [
          { startMs: 1000, endMs: 1800, text: 'two' },
          { startMs: 1800, endMs: 3000, text: 'words' },
        ]),
      ],
      chunk,
    );

    expect(placed[0]!.words).toEqual([
      { startMs: 601_000, endMs: 601_800, text: 'two' },
      { startMs: 601_800, endMs: 603_000, text: 'words' },
    ]);
  });

  /**
   * Words survive their cue being clamped, and that is deliberate.
   *
   * Trimming a word into the shortened cue collapsed both its ends onto the
   * same millisecond, and the span filter that followed then deleted it — so
   * the clamp fired exactly when it was needed and destroyed the last word of
   * the final cue in each chunk. Because the player renders the active line
   * from these words and every other line from `text`, the line visibly lost a
   * word the moment the highlight arrived on it.
   */
  it('keeps every word when the cue around it is clamped', () => {
    const placed = placeChunk(
      [
        cue(599_000, 640_000, 'tail end', [
          { startMs: 599_000, endMs: 599_500, text: 'tail' },
          { startMs: 620_000, endMs: 640_000, text: 'end' },
        ]),
      ],
      chunk,
    );

    // The cue is trimmed to the chunk...
    expect(placed[0]!.endMs).toBe(1_200_000);
    // ...but the words still spell it.
    expect(placed[0]!.words?.map((w) => w.text)).toEqual(['tail', 'end']);
  });

  it('shifts words without reordering or dropping any of them', () => {
    const placed = placeChunk(
      [
        cue(0, 3000, 'a b c', [
          { startMs: 0, endMs: 0, text: 'a' },
          { startMs: 0, endMs: 900, text: 'b' },
          { startMs: 900, endMs: 3000, text: 'c' },
        ]),
      ],
      chunk,
    );

    // Including the zero-span one: Whisper rounds to a 20ms grid, so a quick
    // word can legitimately start and end on the same millisecond.
    expect(placed[0]!.words).toEqual([
      { startMs: 600_000, endMs: 600_000, text: 'a' },
      { startMs: 600_000, endMs: 600_900, text: 'b' },
      { startMs: 600_900, endMs: 603_000, text: 'c' },
    ]);
  });

  it('reports no words rather than an empty list when the cue had none', () => {
    // Null means "estimate these"; an empty array would mean "this cue has no
    // words", and the player would sweep nothing at all.
    expect(placeChunk([cue(0, 1000, 'x', [])], chunk)[0]!.words).toBeNull();
  });

  it('keeps a cue whose end was omitted on the unmeasured path', () => {
    // `durationMs: 0` is the fallback for audio that is not MP3. There is no
    // "rest of the chunk" to award, and falling back to the chunk start put the
    // end before the start — which dropped the cue and holed the transcript.
    const placed = placeChunk(
      [cue(0, 1000, 'first'), cue(2000, 0, 'end omitted'), cue(3000, 4000, 'third')],
      { startMs: 0, durationMs: 0 },
    );
    expect(placed.map((p) => p.text)).toEqual(['first', 'end omitted', 'third']);
  });
});
