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
 * How much of a line has been spoken, 0 to 1.
 *
 * Interpolated linearly across the segment, because the transcripts we have
 * carry per-segment timings and not per-word ones — Whisper's `verbose_json`
 * gives sentence-level spans, and publisher VTT rarely does better. Over a
 * segment of a few seconds, linear is close enough that the fill lands on the
 * right word; it is an honest approximation, not a measurement.
 *
 * A zero-length or reversed segment fills instantly once reached rather than
 * dividing by zero.
 */
export function fillFraction(
  segment: Pick<TranscriptSegment, "start" | "end">,
  currentTime: number,
): number {
  if (currentTime <= segment.start) return 0;
  const span = segment.end - segment.start;
  if (!(span > 0)) return 1;
  return Math.min(1, (currentTime - segment.start) / span);
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
