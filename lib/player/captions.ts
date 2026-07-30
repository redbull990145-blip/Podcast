import type { TranscriptSegment } from "@/lib/db/schema";

/**
 * Which caption line is being spoken at `currentTime`.
 *
 * Takes the previous answer as a hint. During normal playback the line either
 * stays the same or advances by one, so the scan is effectively constant time;
 * only a seek makes it walk. That matters because this runs on every position
 * update, several times a second, for transcripts that can be thousands of
 * lines long.
 *
 * Returns -1 before the first line starts.
 */
export function activeSegmentIndex(
  segments: TranscriptSegment[],
  currentTime: number,
  previousIndex = 0,
): number {
  if (segments.length === 0) return -1;
  if (currentTime < segments[0].start) return -1;

  // A hint that is out of range, or already past the current time, is useless —
  // start over.
  let index =
    previousIndex >= 0 &&
    previousIndex < segments.length &&
    segments[previousIndex].start <= currentTime
      ? previousIndex
      : 0;

  while (index + 1 < segments.length && segments[index + 1].start <= currentTime) {
    index += 1;
  }

  return index;
}
