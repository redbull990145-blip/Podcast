/**
 * Giving individual words a time of their own.
 *
 * A caption cue says "these eleven words occupy 00:12.4 → 00:16.1" and stops
 * there. That is enough to light up a whole line, and it is not enough to do
 * what Apple Music does — sweep the colour through the line at the speed the
 * voice is actually moving. Between those two behaviours is the entire
 * difference between a transcript that highlights and a transcript that reads
 * along with you.
 *
 * **Word timings are used only where they were measured.** Whisper can emit
 * them and our generated transcripts ask it to; a published caption file has
 * nothing finer than a cue and never will, because the format has nowhere to
 * put it. For those, this returns nothing and the player highlights the line as
 * a whole.
 *
 * That restraint is the design, not a missing feature. A previous version
 * *estimated* word spans by weighting characters, and it was convincing enough
 * to be worse than useless: it swept at a constant rate through a sentence the
 * speaker delivered with pauses, so the highlight confidently sat on the wrong
 * word. An honest line beats a precise-looking lie, and it is the same call
 * Apple makes — word-level highlighting on its own transcription, sentence-level
 * on a publisher's file.
 */

import type { TranscriptSegment } from '@cue/types';

/**
 * One word, with the slice of the segment it occupies.
 *
 * `startMs`/`endMs` are absolute, on the same clock as the segment, so a caller
 * compares them against the playhead without carrying the segment around.
 */
export type TimedWord = {
  /** Position within the segment, 0-based. */
  index: number;
  /** The word itself, punctuation included, whitespace excluded. */
  text: string;
  startMs: number;
  endMs: number;
};

/**
 * Roughly how long a word takes to say, in arbitrary units.
 *
 * Speech rate is far closer to constant per *syllable* than per character, but
 * counting syllables properly needs a dictionary, and counting them badly is
 * worse than not counting them: English orthography will tell you "queued" is
 * two syllables and "hideous" is two as well. Characters correlate well enough
 * with syllables across a whole line for the errors to cancel, and they are
 * script-agnostic, which matters because this runs on transcripts in every
 * language the app supports.
 *
 * The two corrections that are worth making:
 *
 * **A floor.** Function words — "a", "of", "the", "in" — are said in barely
 * less time than short content words, because the mouth still has to arrive at
 * them and leave. Raw character count gives "a" a twelfth of the weight of
 * "absolutely" when the truth is nearer a third, and without the floor the
 * sweep rockets through every "of the" and then waits.
 *
 * **Punctuation.** A comma, a full stop or a dash is silence, and it is silence
 * that belongs to the word *before* it — the cue's span includes that pause, so
 * if it is not attributed to anything the sweep spends it running ahead into
 * words nobody has said yet. Attributing it to the preceding word is what makes
 * the sweep pause at the end of a clause, the way the voice does.
 */
const MIN_WEIGHT = 3.2;

/** Extra weight for the silence a mark introduces, in the same units. */
const PAUSE_WEIGHT: Record<string, number> = {
  ',': 1.6,
  ';': 2.4,
  ':': 2.4,
  '—': 2.4,
  '–': 2.4,
  '.': 3.4,
  '!': 3.4,
  '?': 3.4,
  '…': 4.2,
};

/** Marks that end a word without being spoken, for the weight of its body. */
const TRAILING = /[.,;:!?…—–"'”’)\]}]+$/u;

/**
 * The fastest a single word is allowed to sweep, in weight units per second.
 *
 * Needed because Whisper does not report silence. Its word timings are
 * contiguous — measured across a real episode, all 5,853 transitions had a gap
 * of exactly zero — so a pause is not a gap between words but an impossible
 * duration *on* the word before it. That episode holds "And" for 1,640ms and
 * "some" for 1,560ms. Sweeping three letters for a second and a half is the
 * whole of the "it keeps running through the pause" complaint.
 *
 * The number is low because word-by-word speaking rate varies far more than
 * anyone expects. Measured on the same episode:
 *
 *   p05 5.7   p10 7.7   p25 12.3   p50 17.8   p75 25.0   weight units/sec
 *
 * A cap of 12 would trim 24% of all words — it sits near the *median*, so it
 * would be shortening ordinary speech. At 8, just under the tenth percentile,
 * 10% are trimmed and those are the genuine outliers: the cap only ever engages
 * on a word held far longer than its letters can account for.
 */
const MAX_WORD_SWEEP_RATE = 8;

function weigh(word: string): number {
  const body = word.replace(TRAILING, '');
  let weight = Math.max(MIN_WEIGHT, body.length || word.length);

  // Only the last mark counts. `?!` is one pause, not two, and `..."` should
  // not be charged for the quote as well as the stop.
  const marks = word.slice(body.length);
  for (const mark of marks) {
    const pause = PAUSE_WEIGHT[mark];
    if (pause !== undefined) {
      weight += pause;
      break;
    }
  }

  return weight;
}

/**
 * The measured words of a segment, or null if it has none to offer.
 *
 * **Null is the normal answer for a publisher transcript**, and callers must
 * treat it as "highlight the whole line" rather than as a failure. It is also
 * the answer when a word list exists but cannot be trusted — see the
 * reconstruction check below.
 */
export function segmentWords(segment: TranscriptSegment): TimedWord[] | null {
  if (segment.words && segment.words.length > 0) {
    /**
     * Only empty entries are dropped — never short ones.
     *
     * Filtering out zero-span words looks like hygiene and is the same mistake
     * as clamping them: Whisper rounds timings to a 20ms grid, so a genuinely
     * quick word can arrive with its start and end equal, and dropping it takes
     * the word off the screen rather than merely off the clock. `wordProgress`
     * already treats a zero span as a step rather than dividing by it, so such
     * a word simply lights instantly, which is the truth about how it was said.
     */
    const measured = segment.words
      .filter((word) => word.text !== '')
      .map((word, index) => ({
        index,
        text: word.text,
        startMs: word.startMs,
        /**
         * The word's own time, but never more of it than the word can fill.
         *
         * Whisper's word timings are *contiguous*: measured across a real
         * episode, all 5,853 transitions had a gap of exactly zero. It does not
         * report silence — it hands the silence to the word before it. So a
         * pause shows up as a word with an impossible duration, and the episode
         * measured here contains "And" held for 1,640ms and "some" for 1,560ms.
         * Sweeping a three-letter word for a second and a half is precisely the
         * "it just keeps running through the pause" complaint: the *start* was
         * right, the fill simply had nowhere to go.
         *
         * Capping the sweep at a plausible speaking time for the text leaves
         * the start untouched, completes the fill at the pace of speech, and
         * lets the remainder become what it actually was — a gap, in which no
         * word is lit and the line waits. The cap only ever shortens, so a word
         * genuinely said slowly keeps its own timing.
         */
        endMs: Math.min(
          Math.max(word.startMs, word.endMs),
          word.startMs + (weigh(word.text) / MAX_WORD_SWEEP_RATE) * 1000,
        ),
      }));

    /**
     * The words are only usable if they still spell the line.
     *
     * The player renders the *active* line from these pieces and every other
     * line from `segment.text`. So a word list that has lost or gained a word
     * relative to the text — through a bad partition upstream, or through the
     * span filter just above — does not merely mistime the sweep: it makes the
     * line visibly gain or lose a word at the instant the highlight arrives on
     * it, and lose it again as the highlight leaves.
     *
     * Whitespace is ignored because the two are punctuated the same but spaced
     * differently; anything beyond that means these words are not this line's,
     * and falling back to a line-level highlight is the safe answer. Cheap — it
     * runs once per line, when the line becomes active, not per frame.
     */
    if (measured.length > 0) {
      const spelled = measured.map((word) => word.text).join('').replace(/\s+/gu, '');
      if (spelled === segment.text.replace(/\s+/gu, '')) return measured;
    }
  }

  return null;
}

/**
 * How far through a word the playhead is, 0 → 1.
 *
 * Clamped at both ends, so a caller can hand this any position and get the
 * word's *rendered* state rather than having to bounds-check first: everything
 * before the word is 0, everything after is 1.
 */
export function wordProgress(word: TimedWord, positionMs: number): number {
  const span = word.endMs - word.startMs;
  if (span <= 0) return positionMs >= word.endMs ? 1 : 0;
  return Math.max(0, Math.min(1, (positionMs - word.startMs) / span));
}

/**
 * How long a silence has to run before it is worth drawing.
 *
 * Under about three seconds a gap is the ordinary rhythm of speech — a breath,
 * a beat before an answer — and marking it would put a widget between every
 * other pair of lines. Past three the screen has gone still for long enough
 * that a listener starts wondering whether the captions have stopped working,
 * and something has to say "no, it is quiet".
 */
export const GAP_MS = 3000;

/**
 * The silence before a segment, or 0 if there is none worth showing.
 *
 * Takes the *previous* segment's end rather than searching, because the caller
 * already has the array and this is asked once per segment at build time.
 */
export function gapBefore(
  segments: TranscriptSegment[],
  index: number,
): { startMs: number; endMs: number } | null {
  const segment = segments[index];
  if (!segment) return null;

  // Before the first line, the gap is from the top of the episode. Worth
  // showing: a podcast that opens on thirty seconds of theme music is the
  // commonest case of all, and an empty screen at the start of playback is
  // exactly when a listener has least reason to trust that this works.
  const startMs = index === 0 ? 0 : (segments[index - 1]?.endMs ?? 0);
  if (segment.startMs - startMs < GAP_MS) return null;

  return { startMs, endMs: segment.startMs };
}
