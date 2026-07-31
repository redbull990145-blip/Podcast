import type { TranscriptSegment } from "@/lib/db/schema";
import { collapseLoops } from "@/lib/transcript/repetition";
import { captionWords, type CaptionWord } from "./caption-motion";

/**
 * Breaking a transcript into lines you can actually read along with.
 *
 * Whisper's idea of a segment is a decoding window, not a caption. It hands
 * back around thirty seconds at a time — measured on a real episode, a median
 * of 27.1 seconds and 47 words per segment, with the worst at 36.8 seconds and
 * 122 words. Rendered one segment per row that is a wall of text that sits on
 * screen for half a minute, and the highlight inches through it. Per-word
 * timings don't rescue it: the word being spoken is correct and still
 * impossible to find, because the eye has nothing smaller than the paragraph
 * to hold on to. It reads exactly like a highlight sweeping a whole sentence,
 * which is what it is.
 *
 * So the caption line is decided here rather than accepted from the provider.
 * Word timings make that possible: a line can end where the speaker actually
 * paused, and each piece gets real start and end times instead of a share of
 * the paragraph's.
 */

/** Past this many words a line is a paragraph. */
const MAX_LINE_WORDS = 9;

/** Past this many seconds a line outstays its welcome, however short it is. */
const MAX_LINE_SECONDS = 6;

/**
 * Never break for punctuation or a pause below this. Two- and three-word lines
 * flicker past faster than they can be read, and they make the list lurch.
 */
const MIN_LINE_WORDS = 4;

/** A gap this long between words is the speaker drawing breath — a free break. */
const PAUSE_SECONDS = 0.5;

/** Sentence-final punctuation, including the Devanagari danda. */
const SENTENCE_END = /[.!?।॥]["'”’)\]]*$/;

/**
 * Splits provider segments into caption lines.
 *
 * Segments already short enough are passed through by reference, so they keep
 * their identity for the word cache and cost nothing.
 *
 * Every line carries the per-word timings for its own words, so the karaoke
 * fill works on a line exactly as it did on a segment. Where the provider gave
 * no word timings the parent's proportional guess is sliced up instead, which
 * is the same answer the fill would have computed for itself.
 */
export function captionLines(segments: TranscriptSegment[]): TranscriptSegment[] {
  const lines: TranscriptSegment[] = [];

  for (const provided of segments) {
    // Repetition loops are cleaned here as well as at transcription time, so
    // that transcripts already cached from before that existed are readable
    // without anyone having to spend a generation regenerating them. Collapsing
    // an already-clean line returns it unchanged, by reference, so applying it
    // twice costs nothing.
    const segment = collapseLoops(provided);

    if (
      segment.end - segment.start <= MAX_LINE_SECONDS &&
      countWords(segment.text) <= MAX_LINE_WORDS
    ) {
      lines.push(segment);
      continue;
    }

    // Resolved timings for every rendered word, real where the provider knew
    // them and interpolated where it didn't.
    const words = captionWords(segment);
    if (words.length === 0) {
      lines.push(segment);
      continue;
    }

    for (const [from, to] of lineBreaks(words)) {
      lines.push(makeLine(words, from, to));
    }
  }

  return lines;
}

function countWords(text: string): number {
  return (text ?? "").split(/\s+/).filter(Boolean).length;
}

/**
 * Where to break a segment's words, as `[from, to)` ranges covering all of them.
 *
 * Greedy and single-pass. A line closes at the first good reason: it has run
 * long, the speaker finished a sentence, or they paused. The minimum length
 * outranks the last two so that a line never closes on "So." alone.
 */
function lineBreaks(words: CaptionWord[]): [number, number][] {
  const ranges: [number, number][] = [];
  let start = 0;

  for (let i = 0; i < words.length; i += 1) {
    const last = i === words.length - 1;
    const count = i - start + 1;
    const full =
      count >= MAX_LINE_WORDS || words[i].end - words[start].start >= MAX_LINE_SECONDS;

    const next = words[i + 1];
    const natural =
      count >= MIN_LINE_WORDS &&
      (SENTENCE_END.test(words[i].text) ||
        (next !== undefined && next.start - words[i].end >= PAUSE_SECONDS));

    if (last || full || natural) {
      ranges.push([start, i + 1]);
      start = i + 1;
    }
  }

  // A hard break on word count can leave a word or two stranded on their own
  // row at the end. Give them back to the line they came from — a slightly
  // long last line reads better than an orphan.
  const tail = ranges[ranges.length - 1];
  if (ranges.length > 1 && tail[1] - tail[0] < MIN_LINE_WORDS) {
    ranges[ranges.length - 2][1] = tail[1];
    ranges.pop();
  }

  return ranges;
}

/** One caption line from a run of resolved words. */
function makeLine(words: CaptionWord[], from: number, to: number): TranscriptSegment {
  const slice = words.slice(from, to);
  return {
    start: slice[0].start,
    end: slice[slice.length - 1].end,
    text: slice.map((w) => w.text).join(" "),
    words: slice.map((w) => ({ start: w.start, end: w.end, text: w.text })),
  };
}

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
