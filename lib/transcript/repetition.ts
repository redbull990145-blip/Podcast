/**
 * Undoing Whisper's repetition loops.
 *
 * Every autoregressive model can fall into predicting the token it just
 * predicted, and Whisper does it readily on music, crosstalk and accented
 * speech it can't resolve. The output is unmistakable: measured on a
 * three-hour Hindi/English episode, 168 of 375 lines were degenerate, several
 * of them 56 tokens of a single repeated word.
 *
 * Nothing downstream can recover from it. The captions are wrong, and the
 * transcript text is what show notes and chapters are generated from, so a
 * loop quietly becomes the model's impression of what the episode was about.
 *
 * This is deliberately a repair rather than a prevention. Which decoding
 * settings suppress loops depends on the provider, the model and the version,
 * and none of that is verifiable from here — whereas a loop in the output is
 * plainly visible and can be tested against real transcripts. So the pipeline
 * assumes any provider may loop and cleans up after all of them.
 */

import type { TranscriptSegment } from "@/lib/db/schema";

/**
 * Longest phrase treated as a possible loop.
 *
 * Loops are usually one token, but not always — the model settles into short
 * phrases too, and on the measured episode raising this from six to eight took
 * the lines it couldn't clean from eight down to five. Eight is still far past
 * anything a person repeats four times running, so the reach costs nothing:
 * across 375 real lines it changed no ordinary speech.
 */
const MAX_CYCLE = 8;

/**
 * Consecutive repeats before it stops being speech.
 *
 * Four, because three is reachable honestly: "no, no, no" is a real thing to
 * say and survives untouched. Nobody says the same word four times in a row
 * and means it, and the model does it fifty times.
 */
const MIN_REPEATS = 4;

/**
 * How many copies to leave behind.
 *
 * Two rather than one, so a collapsed loop still reads as emphasis rather than
 * as a word that arrived on its own, and so the repair is visible instead of
 * looking like a transcription that simply missed a stretch.
 */
const KEEP_REPEATS = 2;

/** Words compared for repetition ignore case and punctuation. */
function loopKey(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * How many times the phrase of length `cycle` starting at `at` repeats.
 *
 * Counts the phrase itself, so a return of 1 means it doesn't repeat.
 */
function countRepeats(keys: string[], at: number, cycle: number): number {
  let repeats = 1;
  for (;;) {
    const next = at + repeats * cycle;
    if (next + cycle > keys.length) break;

    let same = true;
    for (let k = 0; k < cycle; k += 1) {
      if (keys[next + k] !== keys[at + k]) {
        same = false;
        break;
      }
    }
    if (!same) break;
    repeats += 1;
  }
  return repeats;
}

/**
 * Which tokens to keep, as a list of indices.
 *
 * Walks forward looking for the shortest phrase that repeats often enough to
 * be a loop. Shortest wins because it is the most reduced description of the
 * same run — fifty of one word is also twenty-five of a pair, and collapsing
 * the pair would leave twice as much of it behind.
 */
function keptIndices(keys: string[]): number[] {
  const kept: number[] = [];

  for (let i = 0; i < keys.length; ) {
    let cycle = 0;
    let repeats = 1;

    for (let length = 1; length <= MAX_CYCLE && i + length * MIN_REPEATS <= keys.length; length += 1) {
      const found = countRepeats(keys, i, length);
      if (found >= MIN_REPEATS) {
        cycle = length;
        repeats = found;
        break;
      }
    }

    if (cycle === 0) {
      kept.push(i);
      i += 1;
      continue;
    }

    // Keep the first few copies of the phrase and drop the rest of the run.
    for (let k = 0; k < cycle * KEEP_REPEATS; k += 1) kept.push(i + k);
    i += cycle * repeats;
  }

  return kept;
}

/**
 * One line with its repetition loops collapsed.
 *
 * Returned unchanged, by reference, when there is nothing to collapse — which
 * is most lines, and which keeps the caller's caches keyed on identity intact.
 *
 * The line ends where its surviving words end, giving up the rest of the span
 * rather than stretching to fill it. Stretching was tried first and is worse:
 * on a real episode it left a line of one word running for forty-four seconds,
 * with the fill crawling across that single word the entire time — which looks
 * exactly like the drifting highlight this whole exercise is about removing.
 * Ending honestly leaves a gap instead, and during a gap the last real line
 * stays lit, which is the truthful thing to show for a stretch the model
 * couldn't hear.
 *
 * Only the end moves, and only ever earlier. A line's start still means when
 * it was said, which everything downstream relies on.
 */
export function collapseLoops(segment: TranscriptSegment): TranscriptSegment {
  const tokens = (segment.text ?? "").split(/\s+/).filter(Boolean);
  if (tokens.length < MIN_REPEATS) return segment;

  const keys = tokens.map(loopKey);
  const kept = keptIndices(keys);
  if (kept.length === tokens.length) return segment;

  const text = kept.map((i) => tokens[i]).join(" ");

  // Word timings are only carried over when they line up with the text they
  // were filed against; anything else would attach a time to the wrong word.
  const alignable = segment.words?.length === tokens.length;
  if (!alignable) {
    // Note the explicit `words`: spreading the segment would otherwise put the
    // original list back, timing a line that no longer has those words in it.
    const { words: _dropped, ...rest } = segment;
    return { ...rest, text };
  }

  const words = kept.map((i) => segment.words![i]);
  const end = words.length > 0 ? words[words.length - 1].end : segment.end;

  return { ...segment, text, words, end: Math.min(segment.end, end) };
}

/** Every line, with repetition loops collapsed. */
export function collapseTranscriptLoops(
  segments: TranscriptSegment[],
): TranscriptSegment[] {
  let changed = false;
  const cleaned = segments.map((segment) => {
    const next = collapseLoops(segment);
    if (next !== segment) changed = true;
    return next;
  });
  return changed ? cleaned : segments;
}
