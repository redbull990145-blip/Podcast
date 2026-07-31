/**
 * The maths behind chapter navigation.
 *
 * Kept out of the components for the same reason the caption maths is: these
 * are plain functions with exact answers, and the interesting cases — a chapter
 * list that starts partway in, one that runs past the end of the audio, a
 * position sitting exactly on a boundary — are much easier to pin down here
 * than by scrubbing a real episode.
 *
 * A `Chapter` carries `startTime` and sometimes `endTime`. Only `startTime` is
 * dependable: the podcast namespace makes `endTime` optional and most feeds
 * omit it, so a chapter's end is taken to be the next one's start, and the last
 * chapter runs to the end of the episode.
 */

import type { Chapter } from "@/lib/db/schema";

/**
 * Index of the chapter covering `time`, or -1.
 *
 * -1 rather than 0 when the position is before the first chapter starts, which
 * is a real state and not an edge case: plenty of feeds begin their chapters
 * after a cold open, and claiming the first chapter during it would put the
 * wrong title on screen for the first minute of the episode.
 */
export function activeChapterIndex(chapters: readonly Chapter[], time: number): number {
  let found = -1;
  for (let i = 0; i < chapters.length; i += 1) {
    if (chapters[i].startTime <= time) found = i;
    // Sorted by start time, so the first one that hasn't begun ends the search.
    else break;
  }
  return found;
}

/**
 * Where a chapter starts and ends, in seconds.
 *
 * `duration` closes the last chapter. When it isn't known yet — the audio
 * hasn't loaded — the last chapter is left open-ended by returning its start
 * for both, which callers read as "no measurable span" rather than dividing by
 * a made-up number.
 */
export function chapterBounds(
  chapters: readonly Chapter[],
  index: number,
  duration: number,
): { start: number; end: number } {
  const chapter = chapters[index];
  if (!chapter) return { start: 0, end: 0 };

  const start = chapter.startTime;
  const next = chapters[index + 1]?.startTime;

  // An explicit endTime is honoured when the feed bothered to publish one, but
  // never past where the next chapter begins — a feed that overlaps them would
  // otherwise report progress above 1 for the whole overlap.
  const candidates = [chapter.endTime, next, duration > 0 ? duration : undefined].filter(
    (value): value is number => typeof value === "number" && value > start,
  );

  return { start, end: candidates.length > 0 ? Math.min(...candidates) : start };
}

/** How far through a chapter `time` is, 0 to 1. */
export function chapterProgress(
  chapters: readonly Chapter[],
  index: number,
  time: number,
  duration: number,
): number {
  const { start, end } = chapterBounds(chapters, index, duration);
  const span = end - start;
  if (span <= 0) return 0;
  const fraction = (time - start) / span;
  return fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
}

/**
 * Chapter boundaries as fractions of the episode, for marking the seek bar.
 *
 * The first chapter is dropped when it starts at the very beginning, because a
 * tick at 0 sits under the rounded end of the track and reads as a rendering
 * fault rather than a marker. Anything at or past the end is dropped for the
 * same reason. Sorted and de-duplicated so two chapters sharing a start don't
 * paint one mark twice at double opacity.
 */
export function chapterTicks(chapters: readonly Chapter[], duration: number): number[] {
  if (duration <= 0) return [];

  const seen = new Set<number>();
  for (const chapter of chapters) {
    const fraction = chapter.startTime / duration;
    if (fraction <= 0 || fraction >= 1) continue;
    // Rounded before de-duplicating: two boundaries a fraction of a pixel apart
    // are one mark on screen, and keeping both just darkens it.
    seen.add(Math.round(fraction * 10_000) / 10_000);
  }

  return [...seen].sort((a, b) => a - b);
}

/**
 * Where "previous chapter" should seek to.
 *
 * Restarts the current chapter unless you are already near its start, which is
 * how every media player behaves and what the hand expects — pressing it once
 * gets you back to the beginning of what you're listening to, twice gets you to
 * the one before.
 */
export const RESTART_WINDOW_SECONDS = 3;

export function previousChapterStart(
  chapters: readonly Chapter[],
  time: number,
  duration: number,
): number | null {
  const index = activeChapterIndex(chapters, time);
  if (index < 0) return null;

  const { start } = chapterBounds(chapters, index, duration);
  if (time - start > RESTART_WINDOW_SECONDS) return start;
  return chapters[index - 1]?.startTime ?? start;
}

/** Start of the next chapter, or null if this is the last one. */
export function nextChapterStart(
  chapters: readonly Chapter[],
  time: number,
): number | null {
  const index = activeChapterIndex(chapters, time);
  // Before the first chapter, "next" is the first one rather than the second.
  const next = chapters[index + 1];
  return next ? next.startTime : null;
}
