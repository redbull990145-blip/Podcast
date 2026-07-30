/**
 * The maths behind the Apple-Music-style transcript.
 *
 * Kept out of the component because it is the part worth testing: the component
 * is refs and springs, but these are plain functions with exact answers, and
 * getting the karaoke fill wrong by a fraction is the difference between text
 * that tracks the voice and text that drifts ahead of it.
 */

import type { TranscriptSegment } from "@/lib/db/schema";

/** How a caption line looks at a given distance from the one being spoken. */
export type LineEmphasis = {
  opacity: number;
  scale: number;
  /** Blur radius in pixels. */
  blur: number;
};

/**
 * Emphasis by distance from the active line, nearest first; the last entry is
 * the floor for everything further away.
 *
 * Two things are load-bearing here. The scale range is tiny — 5% end to end —
 * because text is the one thing a user is actively reading, and anything larger
 * turns "this line matters" into "the layout is moving". And the table stops
 * changing after three lines out, which means advancing one line only re-animates
 * the handful of rows whose values actually differ, not every row on screen.
 */
const EMPHASIS: readonly LineEmphasis[] = [
  { opacity: 1, scale: 1, blur: 0 },
  { opacity: 0.42, scale: 0.972, blur: 0.7 },
  { opacity: 0.3, scale: 0.958, blur: 1.2 },
  { opacity: 0.24, scale: 0.95, blur: 1.6 },
];

/** The distance past which emphasis is constant. */
export const EMPHASIS_RANGE = EMPHASIS.length - 1;

/**
 * Look of a line `index` when `active` is being spoken.
 *
 * Symmetric: a line just read is dimmed exactly as much as one about to be.
 * Apple does the same, and the alternative — leaving spoken lines bright —
 * makes the eye drift backwards up the list.
 *
 * `active` of -1 means nothing is being spoken yet, in which case every line
 * sits at the floor rather than one arbitrarily lighting up.
 */
export function lineEmphasis(index: number, active: number): LineEmphasis {
  if (active < 0) return EMPHASIS[EMPHASIS_RANGE];
  const distance = Math.min(Math.abs(index - active), EMPHASIS_RANGE);
  return EMPHASIS[distance];
}

/**
 * How much of a line has been spoken, 0 to 1, as a fraction of the line's text.
 *
 * When the segment carries per-word timings (`segment.words`, from Whisper's
 * word-level output) the fill tracks the actual spoken word: it steps to each
 * word's leading edge as it begins, eases across it while it is being said, and
 * — the part that matters — *holds* through a pause, because the next word
 * hasn't started. Linear interpolation across the whole line has no concept of a
 * pause and sweeps on regardless, which is exactly the "captions moving ahead of
 * the voice" the word timings exist to fix.
 *
 * Progress is measured in characters, not seconds: the fill is a colour stop on
 * the rendered text, so positioning it at the nth character puts the colour on
 * the nth word rather than a second-based guess that ignores how long each word
 * actually took to say.
 *
 * Without word timings (publisher VTT/JSON, or an older cached transcript) the
 * fill falls back to a linear sweep across the segment — an honest approximation
 * that is the best a line-level timestamp supports. A zero-length or reversed
 * segment fills instantly once reached rather than dividing by zero.
 */
export function fillFraction(
  segment: Pick<TranscriptSegment, "start" | "end" | "words">,
  currentTime: number,
): number {
  if (currentTime <= segment.start) return 0;

  const words = segment.words;
  if (words && words.length > 0) return wordFillFraction(words, currentTime);

  const span = segment.end - segment.start;
  if (!(span > 0)) return 1;
  return Math.min(1, (currentTime - segment.start) / span);
}

/**
 * Per-word fill, expressed as a fraction of the line's total characters.
 *
 * Each word owns a slice of the line proportional to its visible length (the
 * word plus the one space that follows it). The fill sits at the start of the
 * current word until that word ends, then advances to the next — so a pause
 * between words freezes the colour exactly where the speech stopped.
 *
 * Inside a word the sweep eases across that word's character slice, which is
 * what keeps the highlight moving smoothly instead of snapping word to word.
 */
function wordFillFraction(
  words: NonNullable<TranscriptSegment["words"]>,
  currentTime: number,
): number {
  // Total visible length, counting one trailing space per word. A word's share
  // of the line is (its length + 1) / totalChars, which is how far its leading
  // and trailing edges sit as a fraction of the rendered text.
  const lengths = words.map((w) => w.text.length + 1);
  const totalChars = lengths.reduce((sum, n) => sum + n, 0);
  if (totalChars <= 0) return 1;

  // Walk in order; stop at the first word that has not yet begun. Everything
  // before it is fully spoken, the current word is mid-flight, and anything
  // after is unspoken.
  let spokenChars = 0;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const slice = lengths[i] / totalChars;

    // Before this word starts: it and everything after is unspoken. The fill
    // holds at the end of the previous word, which is where speech actually
    // paused — no racing ahead through the gap.
    if (currentTime < word.start) break;

    const wordSpan = word.end - word.start;
    // A zero-length word (or one the provider reported as instantaneous) counts
    // as fully spoken the moment it starts.
    const within = wordSpan > 0 ? (currentTime - word.start) / wordSpan : 1;

    if (within >= 1) {
      // This word is done; its whole slice is spoken, carry on to the next.
      spokenChars += slice;
      continue;
    }

    // Mid-word: the leading portion of the slice is spoken, eased across it.
    return clamp01(spokenChars + slice * within);
  }

  return clamp01(spokenChars);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Where the list has to sit for `index` to be centred, as a translateY.
 *
 * Negative, because the list moves up to bring later lines into view. Clamped
 * so the first and last lines can't be dragged into empty space — the same
 * bounds a scroll container would have enforced for free.
 */
export function centreOffset(
  tops: number[],
  total: number,
  index: number,
  viewportHeight: number,
  rowHeight: number,
): number {
  const top = tops[index] ?? 0;
  const ideal = top - viewportHeight / 2 + rowHeight / 2;
  const max = Math.max(0, total - viewportHeight);
  const scrollTop = Math.max(0, Math.min(ideal, max));
  // `-0` is a valid translateY but a nuisance to assert against and to compare
  // for equality against a freshly clamped 0.
  return scrollTop === 0 ? 0 : -scrollTop;
}

/** Clamps a translateY to the scrollable bounds. */
export function clampOffset(
  offset: number,
  total: number,
  viewportHeight: number,
): number {
  const max = Math.max(0, total - viewportHeight);
  const clamped = Math.max(-max, Math.min(0, offset));
  return clamped === 0 ? 0 : clamped;
}

/**
 * Whether `index` is on screen for a given translateY.
 *
 * Used to decide when following resumes: someone who drags back to the line
 * being spoken has said, without pressing anything, that they want to follow
 * along again.
 */
export function isRowVisible(
  tops: number[],
  index: number,
  offset: number,
  viewportHeight: number,
): boolean {
  const top = tops[index];
  if (top === undefined) return false;
  const scrollTop = -offset;
  return top >= scrollTop - 40 && top <= scrollTop + viewportHeight;
}
