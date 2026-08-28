/**
 * Finding where a snatch of recognised speech sits in the publisher's transcript.
 *
 * This is the measurement the staircase in `map.ts` is fitted to. Thirty seconds
 * of the audio a listener is actually served goes to Whisper; the words that come
 * back are located in the publisher's cue file; and the difference between where
 * they were *heard* and where the file *says* they are is one anchor.
 *
 * **Why matching and not just timestamps.** The two sides are not comparable
 * directly — that is the entire bug. What is comparable is the words, and words
 * survive ad insertion untouched.
 *
 * **Seed and vote, rather than edit distance.** Aligning an 80-word hypothesis
 * against a 10,000-word reference with Levenshtein or Needleman-Wunsch is 800,000
 * cells for one probe, and it answers a harder question than the one being asked.
 * Instead every three-word run in the reference is indexed, each run in the
 * hypothesis looks itself up, and each hit votes for the displacement that would
 * explain it. The right displacement collects votes from all over the window
 * while spurious hits scatter, so the winner is usually unambiguous by an order
 * of magnitude — and the whole thing is linear. It also degrades in the right
 * direction: a sermon that repeats a phrase four times produces four candidate
 * displacements, and the correct one is the only one the *rest* of the window
 * also agrees with.
 *
 * Nothing here trusts a single match. Every function can decline, and a probe
 * that lands in music, in an ad, or on a passage the publisher paraphrased is
 * expected to return null rather than a low-quality anchor — `map.ts` would
 * filter it out anyway, and refusing early keeps the reason legible.
 */

import type { TranscriptSegment } from '@cue/types';
import type { Anchor } from './map.ts';

/**
 * Words per seed.
 *
 * Two is too common — "of the" occurs hundreds of times in an hour of speech and
 * votes for hundreds of displacements, which is noise rather than evidence. Four
 * is fragile, because one misrecognised word destroys every seed overlapping it,
 * and Whisper misrecognises roughly one word in twenty even when it is doing
 * well. Three is the shortest run that is usually unique in an episode and still
 * survives that error rate: with a 5% word error rate, ~86% of trigrams are
 * clean.
 */
const SEED = 3;

/** Below this share of the hypothesis matching, the probe found nothing. */
export const MIN_MATCH_RATIO = 0.35;

/** A hypothesis shorter than this cannot vote its way to a confident answer. */
const MIN_TOKENS = SEED * 3;

/**
 * One normalised word, and when it was said.
 *
 * `ms` is on whatever timeline the token came from: episode time for the
 * reference, audio time for the hypothesis. Keeping them in the same shape is
 * what lets the subtraction at the bottom be a subtraction.
 */
export type Token = { text: string; ms: number };

/**
 * Reduce text to the part that survives being spoken and re-transcribed.
 *
 * Case, punctuation and markup go, because no two transcribers agree on them.
 * **Digits go too, along with anything containing one.** That is the load-bearing
 * choice here: Whisper writes "2024" where a publisher's transcriber wrote
 * "twenty twenty-four", and "$5" against "five dollars", so numerals are the one
 * category guaranteed to disagree while looking like a legitimate mismatch.
 * Normalising them into agreement means implementing spoken-number expansion in
 * both directions, which is a large amount of locale-specific machinery to
 * recover a few tokens per window. Dropping them costs a little signal and
 * removes a whole class of false mismatch.
 *
 * Apostrophes are kept, so "dont" and "don't" do not collide with each other's
 * neighbours — contractions are frequent enough in speech to matter.
 */
export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z']+/)
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter((word) => word.length > 0);
}

/**
 * Flatten a transcript into timed tokens.
 *
 * Word times are interpolated across each cue, and it is worth being explicit
 * that this is an estimate, because elsewhere in this codebase estimating word
 * timings is exactly what `words.ts` refuses to do. The difference is what the
 * number is for. There, an invented time drives a highlight under a reader's eye,
 * where being wrong by half a second is visible and irritating and cannot be
 * argued with. Here it feeds one term of a median taken over dozens of matched
 * pairs, where independent errors either side of the truth cancel and the result
 * is checked against a tolerance of a second and a half. Using the cue's start
 * for every word inside it — the only alternative that invents nothing — would
 * bias every anchor early by half a cue, which is a systematic error where this
 * is a random one.
 *
 * Cues with no duration contribute their start time unchanged; untimed HTML
 * transcripts therefore produce tokens that are all at zero, and the caller is
 * expected not to have got this far with one.
 */
export function referenceTokens(segments: readonly TranscriptSegment[]): Token[] {
  const tokens: Token[] = [];

  for (const segment of segments) {
    const words = normalize(segment.text);
    if (words.length === 0) continue;

    const span = Math.max(0, segment.endMs - segment.startMs);

    for (let i = 0; i < words.length; i += 1) {
      tokens.push({
        text: words[i]!,
        ms: Math.round(segment.startMs + (span * i) / words.length),
      });
    }
  }

  return tokens;
}

/** Every position each three-word run appears at. Built once, reused per probe. */
export type ReferenceIndex = {
  tokens: Token[];
  seeds: Map<string, number[]>;
};

export function indexReference(tokens: Token[]): ReferenceIndex {
  const seeds = new Map<string, number[]>();

  for (let i = 0; i + SEED <= tokens.length; i += 1) {
    const key = keyAt(tokens, i);
    const at = seeds.get(key);
    if (at) at.push(i);
    else seeds.set(key, [i]);
  }

  return { tokens, seeds };
}

function keyAt(tokens: readonly Token[], at: number): string {
  let key = tokens[at]!.text;
  for (let i = 1; i < SEED; i += 1) key += ' ' + tokens[at + i]!.text;
  return key;
}

/**
 * Locate one probe's words in the reference and report the time difference.
 *
 * `hypothesis` carries absolute audio times — the caller has already added the
 * probe's own offset into the episode, which it knows exactly because the byte
 * position it read from converts to a time on a constant-bitrate file.
 */
export function findAnchor(
  index: ReferenceIndex,
  hypothesis: readonly Token[],
  options: { minMatchRatio?: number } = {},
): Anchor | null {
  const minMatchRatio = options.minMatchRatio ?? MIN_MATCH_RATIO;

  if (hypothesis.length < MIN_TOKENS || index.tokens.length < MIN_TOKENS) return null;

  /**
   * Vote for displacements.
   *
   * A hit at reference position `j` for the hypothesis run starting at `i` is a
   * claim that the whole window sits `j - i` tokens along. Seeds that occur
   * absurdly often are skipped rather than counted: a run appearing in fifty
   * places is a stock phrase, it would cast fifty votes, and its evidence is
   * worth less than a run appearing twice, not twenty-five times more.
   */
  const votes = new Map<number, number>();
  const CROWDED = 24;

  for (let i = 0; i + SEED <= hypothesis.length; i += 1) {
    const at = index.seeds.get(keyAt(hypothesis, i));
    if (!at || at.length > CROWDED) continue;

    for (const j of at) {
      const displacement = j - i;
      votes.set(displacement, (votes.get(displacement) ?? 0) + 1);
    }
  }

  if (votes.size === 0) return null;

  let best = 0;
  let bestVotes = 0;
  for (const [displacement, count] of votes) {
    if (count > bestVotes) {
      bestVotes = count;
      best = displacement;
    }
  }

  /**
   * Score the winner honestly, on every token rather than on the seeds.
   *
   * The vote picked a candidate; this asks how much of the window it actually
   * explains. A displacement that won with three votes out of eighty runs is a
   * coincidence, and only counting matched tokens reveals that.
   */
  const offsets: number[] = [];
  let matched = 0;

  for (let i = 0; i < hypothesis.length; i += 1) {
    const j = i + best;
    if (j < 0 || j >= index.tokens.length) continue;

    const reference = index.tokens[j]!;
    if (reference.text !== hypothesis[i]!.text) continue;

    matched += 1;
    offsets.push(hypothesis[i]!.ms - reference.ms);
  }

  const ratio = matched / hypothesis.length;
  if (ratio < minMatchRatio || offsets.length === 0) return null;

  offsets.sort((a, b) => a - b);
  const median = offsets[Math.floor(offsets.length / 2)]!;

  /**
   * Anchored at the middle of the window rather than at its first word.
   *
   * The offset is a median over the whole probe, so the moment it best describes
   * is the middle of the probe. Reporting it against the first word would place
   * every anchor fifteen seconds early, which the staircase would then site its
   * boundaries by.
   */
  const middle = hypothesis[Math.floor(hypothesis.length / 2)]!;

  return {
    audioMs: middle.ms,
    transcriptMs: middle.ms - median,
    similarity: ratio,
  };
}
