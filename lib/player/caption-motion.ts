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
 * One rendered word of a caption line, with where it sits and when it is said.
 *
 * `from`/`to` are positions in the line's *character* space, 0 to 1. They are
 * what lets each word paint its own fill: the line publishes a single progress
 * value and every word works out its own share of it, so the colour is confined
 * to the word being spoken instead of sweeping the sentence.
 */
export type CaptionWord = {
  text: string;
  from: number;
  to: number;
  start: number;
  end: number;
};

/**
 * Splitting a line into words is done once per segment and reused, because it
 * happens for every visible row and the answer never changes.
 */
const wordCache = new WeakMap<object, CaptionWord[]>();

/**
 * The words of a line, positioned in character space and timed in seconds.
 *
 * Tokenising `segment.text` rather than trusting `segment.words` to be the
 * rendered text matters: the timings are what the provider heard, the text is
 * what is on screen, and they are not always the same list. Whisper drops or
 * merges the odd token, and a publisher transcript has no words at all. Since
 * the fill is painted onto the rendered text, the rendered text has to be what
 * defines the boxes — timings are then mapped onto it.
 *
 * When per-word timings line up one-to-one they are used as given. Otherwise
 * the line's own span is shared out in proportion to how long each word is,
 * which is a guess, but a per-word one: the highlight still steps word by word
 * rather than gliding across the whole sentence, which is the part that reads
 * as wrong.
 */
export function captionWords(
  segment: Pick<TranscriptSegment, "start" | "end" | "text" | "words">,
): CaptionWord[] {
  const cached = wordCache.get(segment as object);
  if (cached) return cached;

  // Defensive: a line with no text has no words to light up, and a transcript
  // from an unfamiliar source should not be able to throw here.
  const tokens = (segment.text ?? "").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  // A word's width is its own length plus the space that follows it, which is
  // how much of the rendered line it actually occupies.
  const widths = tokens.map((t) => t.length + 1);
  const totalWidth = widths.reduce((sum, n) => sum + n, 0);

  const timings = segment.words;
  const aligned = timings && timings.length === tokens.length ? timings : null;

  const span = Math.max(0, segment.end - segment.start);

  const words: CaptionWord[] = [];
  let charsSoFar = 0;
  let elapsed = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const from = charsSoFar / totalWidth;
    charsSoFar += widths[i];
    const to = charsSoFar / totalWidth;

    let start: number;
    let end: number;
    if (aligned) {
      start = aligned[i].start;
      end = aligned[i].end;
    } else {
      // Proportional share of the line's duration.
      const share = (widths[i] / totalWidth) * span;
      start = segment.start + elapsed;
      elapsed += share;
      end = segment.start + elapsed;
    }

    words.push({ text: tokens[i], from, to, start, end });
  }

  wordCache.set(segment as object, words);
  return words;
}

/**
 * How much of a line has been spoken, 0 to 1, in the line's character space.
 *
 * The value is a position along the rendered text, not along the clock, because
 * that is what the paint needs: each word knows which slice of the line it
 * occupies and can turn one number into its own local fill.
 *
 * The walk holds the fill at the end of the last finished word until the next
 * one actually begins, so a pause freezes the colour where the speech stopped
 * rather than gliding on through the silence.
 */
export function fillFraction(
  segment: Pick<TranscriptSegment, "start" | "end" | "text" | "words">,
  currentTime: number,
): number {
  if (currentTime <= segment.start) return 0;

  const words = captionWords(segment);
  if (words.length === 0) return 1;

  let spoken = 0;
  for (const word of words) {
    // Not started: everything from here on is unspoken.
    if (currentTime < word.start) break;

    const wordSpan = word.end - word.start;
    const within = wordSpan > 0 ? (currentTime - word.start) / wordSpan : 1;

    if (within >= 1) {
      spoken = word.to;
      continue;
    }

    return clamp01(word.from + (word.to - word.from) * within);
  }

  return clamp01(spoken);
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
