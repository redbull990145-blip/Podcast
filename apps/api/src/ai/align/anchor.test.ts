/**
 * Locating recognised speech in a publisher's cue file.
 *
 * The hypotheses here are deliberately damaged — words dropped, words wrong,
 * numerals spelled the other way — because a clean one proves nothing. Whisper
 * misrecognises roughly one word in twenty on good audio, and the question this
 * module has to answer is whether it can still find the passage anyway.
 */

import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@cue/types';
import {
  findAnchor,
  indexReference,
  normalize,
  referenceTokens,
  type Token,
} from './anchor.ts';

/**
 * A transcript of `text`, cut into cues of `wordsPerCue` at `msPerCue` each.
 * Cue-shaped rather than one long block, so the interpolation is exercised.
 */
function transcriptOf(text: string, wordsPerCue = 8, msPerCue = 3000): TranscriptSegment[] {
  const words = text.split(/\s+/).filter(Boolean);
  const segments: TranscriptSegment[] = [];

  for (let i = 0; i < words.length; i += wordsPerCue) {
    const index = segments.length;
    segments.push({
      index,
      startMs: index * msPerCue,
      endMs: (index + 1) * msPerCue,
      text: words.slice(i, i + wordsPerCue).join(' '),
      speaker: null,
    });
  }

  return segments;
}

/**
 * Recognised words, spread evenly from `startMs` at `msPerWord`.
 *
 * The default matches the pacing `transcriptOf` gives the reference — eight
 * words to a three-second cue — because the offset this module reports is a
 * median of per-word differences, and two sides running at different speeds
 * produce a spread of differences rather than one number.
 */
function heard(text: string, startMs: number, msPerWord = 375): Token[] {
  return normalize(text).map((word, i) => ({ text: word, ms: startMs + i * msPerWord }));
}

/**
 * Enough distinct prose that three-word runs are mostly unique, which is the
 * condition the seeding relies on.
 */
const SERMON = `
faith is not the absence of doubt but the decision to keep walking anyway
the storm did not ask permission before it arrived and it will not ask
permission before it leaves so stop negotiating with the weather and start
building something that survives it every person in this room has carried
a season they never announced and the carrying is the testimony not the
announcement when the ground shifts under you the question is never whether
you will fall the question is what you reach for on the way down and whether
what you reach for was placed there long before you needed it
`;

const segments = transcriptOf(SERMON);
const index = indexReference(referenceTokens(segments));

describe('normalize', () => {
  it('strips case and punctuation but keeps contractions whole', () => {
    expect(normalize("Don't STOP, believing!")).toEqual(['don\'t', 'stop', 'believing']);
  });

  it('drops numerals rather than pretending they will agree', () => {
    // Whisper writes "2024" where a publisher wrote "twenty twenty-four", and
    // "$5" against "five dollars". Neither side can be normalised into the
    // other without spoken-number expansion, so both are dropped.
    expect(normalize('in 2024 we raised $5 million')).toEqual([
      'in', 'we', 'raised', 'million',
    ]);
  });

  it('folds curly apostrophes onto straight ones', () => {
    expect(normalize('it’s fine')).toEqual(normalize("it's fine"));
  });

  it('returns nothing for text with no words in it', () => {
    expect(normalize('   —  ... 123 ')).toEqual([]);
  });
});

describe('referenceTokens', () => {
  it('spreads word times across the cue rather than stacking them on its start', () => {
    const tokens = referenceTokens([
      { index: 0, startMs: 10_000, endMs: 14_000, text: 'one two three four', speaker: null },
    ]);

    expect(tokens.map((t) => t.ms)).toEqual([10_000, 11_000, 12_000, 13_000]);
  });

  it('leaves a zero-length cue at its own start', () => {
    const tokens = referenceTokens([
      { index: 0, startMs: 5_000, endMs: 5_000, text: 'held still', speaker: null },
    ]);

    expect(tokens.map((t) => t.ms)).toEqual([5_000, 5_000]);
  });

  it('skips cues with no words without losing the ones around them', () => {
    const tokens = referenceTokens([
      { index: 0, startMs: 0, endMs: 1_000, text: '...', speaker: null },
      { index: 1, startMs: 1_000, endMs: 2_000, text: 'still here', speaker: null },
    ]);

    expect(tokens.map((t) => t.text)).toEqual(['still', 'here']);
  });
});

describe('findAnchor', () => {
  /**
   * Where a passage really sits in the reference, for building a probe.
   *
   * Matches the whole phrase, not its first word — a phrase opening on "the"
   * would otherwise be located at the first "the" in the episode and every
   * assertion below would be measuring the wrong distance.
   */
  function referenceMsOf(phrase: string): number {
    const words = normalize(phrase);

    for (let i = 0; i + words.length <= index.tokens.length; i += 1) {
      if (words.every((word, k) => index.tokens[i + k]!.text === word)) {
        return index.tokens[i]!.ms;
      }
    }

    throw new Error(`phrase not in the reference: ${phrase}`);
  }

  it('recovers a constant offset from a clean probe', () => {
    const phrase = 'the storm did not ask permission before it arrived and it will not ask permission';
    const at = referenceMsOf(phrase);

    const anchor = findAnchor(index, heard(phrase, at + 8_693))!;

    expect(anchor).not.toBeNull();
    expect(anchor.similarity).toBe(1);
    expect(anchor.audioMs - anchor.transcriptMs).toBe(8_693);
  });

  it('still finds the passage when a fifth of the words are wrong', () => {
    const phrase = 'every person in this room has carried a season they never announced and the carrying';
    const at = referenceMsOf(phrase);
    const damaged = 'every person in this womb has carried a reason they never announced and the carrying';

    const anchor = findAnchor(index, heard(damaged, at + 8_693))!;

    expect(anchor).not.toBeNull();
    expect(anchor.similarity).toBeGreaterThan(0.8);
    expect(anchor.audioMs - anchor.transcriptMs).toBe(8_693);
  });

  it('reports nothing for a probe that landed in an ad', () => {
    const advert =
      'this episode is brought to you by a mattress company that wants you to sleep better tonight';

    expect(findAnchor(index, heard(advert, 400_000))).toBeNull();
  });

  it('declines a probe too short to be evidence', () => {
    expect(findAnchor(index, heard('faith is not', 0))).toBeNull();
  });

  it('picks the repeat the rest of the window agrees with', () => {
    // "ask permission before it" occurs twice. Only one of them is followed by
    // "leaves so stop negotiating", and that is the one the votes should find.
    const phrase = 'permission before it leaves so stop negotiating with the weather and start building';
    const at = referenceMsOf('leaves so stop');

    const anchor = findAnchor(index, heard(phrase, at + 20_000))!;

    expect(anchor).not.toBeNull();
    // The right occurrence puts the offset near 20s; the wrong one is a whole
    // clause earlier and would land tens of seconds away.
    expect(anchor.audioMs - anchor.transcriptMs).toBeGreaterThan(17_000);
    expect(anchor.audioMs - anchor.transcriptMs).toBeLessThan(23_000);
  });

  it('anchors on the middle of the probe, not its first word', () => {
    const phrase = 'the storm did not ask permission before it arrived and it will not ask permission';
    const at = referenceMsOf(phrase);

    // A 30-second probe: if it anchored on the first word the reported audio
    // time would be the probe's start rather than its centre.
    const probe = heard(phrase, at, 2_000);
    const anchor = findAnchor(index, probe)!;

    expect(anchor.audioMs).toBe(probe[Math.floor(probe.length / 2)]!.ms);
  });

  it('refuses when the reference itself is empty', () => {
    const empty = indexReference(referenceTokens([]));
    expect(findAnchor(empty, heard('faith is not the absence of doubt but the decision', 0))).toBeNull();
  });
});
