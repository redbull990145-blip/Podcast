import type { TranscriptSegment, TranscriptWord } from "@/lib/db/schema";

/**
 * Making a transcript safe to synchronise against, before anything tries to.
 *
 * Everything downstream of storage assumes a timeline that only moves forwards:
 * `activeSegmentIndex` resumes its scan from the previous answer and would walk
 * past a line that starts before the one before it; `captionWords` shares out
 * unanchored time between neighbouring anchors and divides by the span between
 * them; `fillFraction` walks words expecting each to begin no earlier than the
 * last ended. None of those are wrong to assume it — a spoken transcript *is*
 * monotonic — but none of them are the right place to defend it either, because
 * a repair applied at read time is applied on every read, and a repair applied
 * per-consumer is three chances to disagree about what the timeline is.
 *
 * So it is done once, here, on the way in.
 *
 * ## What actually arrives broken
 *
 * Not hypotheticals. Whisper's segment boundaries and its word timings come
 * from different passes and disagree by hundredths of a second at the seams.
 * Chunked transcription shifts each chunk onto a cumulative timeline, and a
 * chunk whose measured duration was a frame long overlaps the next. Publisher
 * VTT is written by hand often enough to contain genuine typos — a cue ending
 * before it starts, two cues with identical times, a stray negative. A model
 * that loses its place can emit the same word twice with the same timestamp.
 *
 * ## Repair, not rejection
 *
 * Every defect below has an unambiguous least-damaging reading, so none of them
 * throws away the line. A transcript with one bad cue is still worth almost all
 * of its value, and refusing it would leave the listener with no captions at
 * all over a fault they cannot see and could not fix.
 */

/** What was wrong with a transcript, for logging and for tests to assert on. */
export type IntegrityReport = {
  /** Lines dropped because nothing could be recovered from them. */
  dropped: number;
  /** Timestamps moved forward to restore monotonicity. */
  reordered: number;
  /** Ends pulled back to the start of the following line. */
  overlaps: number;
  /** Negative or non-finite values replaced. */
  invalid: number;
  /** Zero- or negative-length spans given a length. */
  degenerate: number;
  /** Consecutive entries identical in time and text. */
  duplicates: number;
  /** Word timings pulled back inside the line that owns them. */
  clamped: number;
};

export type IntegrityResult = {
  segments: TranscriptSegment[];
  report: IntegrityReport;
  /** True when nothing needed changing — the caller can keep the original. */
  clean: boolean;
};

/**
 * The shortest span a word or line may occupy.
 *
 * One millisecond, because the only requirement is that the span is positive:
 * `captionWords` divides by `to - from` and `fillFraction` divides by
 * `end - start`, and both produce Infinity at zero. It is deliberately far
 * below anything perceptible rather than a plausible-looking minimum — a
 * repaired span is a placeholder standing in for a timing the provider failed
 * to give, and stretching it to something that *looks* like a real word would
 * push the neighbours it sits between out of the way.
 */
const MIN_SPAN_SECONDS = 0.001;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Forces a list of timed entries onto a monotonic, non-overlapping timeline.
 *
 * Shared by lines and by the words inside them because the invariant is the
 * same at both scales and so is the correct repair. Only the counters differ,
 * and those are passed in.
 *
 * The rule is that a start may never precede the previous end, and an end may
 * never precede its own start. Both are enforced by moving values *forward*
 * only: pulling a start backwards to meet an overlapping neighbour would put
 * the caption ahead of the audio, and being late is the recoverable error here
 * — the listener reads a word a moment after hearing it, which is what reading
 * along is anyway. Being early means reading a word before it is said, which is
 * the thing that registers as broken.
 */
function monotonise<T extends { start: number; end: number }>(
  entries: T[],
  report: IntegrityReport,
): T[] {
  const out: T[] = [];
  let floor = 0;

  for (const entry of entries) {
    let start = entry.start;
    let end = entry.end;

    if (!isFiniteNumber(start) || start < 0) {
      start = floor;
      report.invalid += 1;
    }
    if (!isFiniteNumber(end) || end < 0) {
      end = start + MIN_SPAN_SECONDS;
      report.invalid += 1;
    }

    if (start < floor) {
      start = floor;
      report.reordered += 1;
    }
    if (end < start + MIN_SPAN_SECONDS) {
      end = start + MIN_SPAN_SECONDS;
      report.degenerate += 1;
    }

    out.push({ ...entry, start, end });
    floor = end;
  }

  return out;
}

/**
 * Trims each entry's end back to the next one's start where they overlap.
 *
 * Runs after `monotonise`, which has already guaranteed starts ascend; what is
 * left is a line whose end reaches past where the next line begins. Left alone
 * that makes two lines simultaneously "current" by any end-inclusive test, and
 * makes `fillFraction` on the earlier one keep sweeping through speech that
 * belongs to the later one.
 *
 * The next start wins rather than the current end, because a start is the more
 * reliable of the two figures: it is where a recogniser detected speech
 * beginning, whereas an end is frequently padded out to the next boundary.
 */
function trimOverlaps<T extends { start: number; end: number }>(
  entries: T[],
  report: IntegrityReport,
): T[] {
  for (let i = 0; i < entries.length - 1; i += 1) {
    const next = entries[i + 1];
    if (entries[i].end <= next.start) continue;
    const end = Math.max(entries[i].start + MIN_SPAN_SECONDS, next.start);
    if (end !== entries[i].end) {
      entries[i] = { ...entries[i], end };
      report.overlaps += 1;
    }
  }
  return entries;
}

/**
 * Consecutive entries identical in time and text are one utterance, emitted
 * twice.
 *
 * Must run *before* `monotonise`, on the values as they arrived. Monotonising
 * first pushes the second copy's start up to the first copy's end, at which
 * point the two are no longer identical and this finds nothing — the duplicate
 * survives as a zero-content line wedged into the timeline. Found by the test
 * for exactly that case, which failed on the first version of this file.
 */
function dedupe<T extends { start: number; end: number; text: string }>(
  entries: T[],
  report: IntegrityReport,
): T[] {
  const out: T[] = [];
  for (const entry of entries) {
    const previous = out[out.length - 1];
    if (
      previous &&
      previous.start === entry.start &&
      previous.end === entry.end &&
      previous.text === entry.text
    ) {
      report.duplicates += 1;
      continue;
    }
    out.push(entry);
  }
  return out;
}

/**
 * Sort, dedupe, trim, monotonise — in that order, which is the whole of the
 * repair and is shared by lines and by the words inside them.
 *
 * The order is not interchangeable. Each step was moved at least once during
 * development and each move broke a test that is still in the suite:
 *
 *  - **Sort first**, because `trimOverlaps` compares each entry with its
 *    successor and only means anything once starts ascend.
 *  - **Dedupe before monotonise**, because monotonising pushes the second copy
 *    of a duplicated line to start where the first ends, at which point the two
 *    are no longer identical and the duplicate survives as a zero-content line
 *    wedged into the timeline.
 *  - **Trim before monotonise**, and this is the one that matters most for
 *    synchronisation. Both orders produce a valid timeline; they disagree about
 *    *which* figure was wrong. Given a line running to 12s followed by one
 *    starting at 10s, monotonising first accepts the 12 and pushes the next
 *    line's start out to it — delaying a caption by two seconds past the words
 *    it belongs to. Trimming first accepts the 10 and pulls the previous end
 *    back, which is right, because an end is routinely padded out to the next
 *    boundary while a start is where a recogniser actually detected speech.
 *
 * `reordered` counts timestamps that had to be *moved*; a pure sort moves
 * nothing and is reported through `sorted` instead, so the caller can tell a
 * transcript that merely arrived shuffled from one that was internally
 * inconsistent. Both still mean the returned array is the repaired copy.
 */
function normalise<T extends { start: number; end: number; text: string }>(
  entries: readonly T[],
  report: IntegrityReport,
): { entries: T[]; sorted: boolean } {
  const ordered = [...entries].sort((a, b) => a.start - b.start);
  const sorted = ordered.some((entry, i) => entry !== entries[i]);

  let out = dedupe(ordered, report);
  out = trimOverlaps(out, report);
  out = monotonise(out, report);

  return { entries: out, sorted };
}

/**
 * Cleans one line's word timings and clamps them inside the line.
 *
 * Words are clamped to their parent rather than the parent being widened to fit
 * them, because the line's own span is what positions it in the list and what
 * every neighbouring line has already been reconciled against. A word reaching
 * past its line is a seam artefact — the two came from different passes — and
 * the line is the figure the rest of the pipeline has agreed on.
 */
function repairWords(
  words: TranscriptWord[] | undefined,
  line: { start: number; end: number },
  report: IntegrityReport,
): TranscriptWord[] | undefined {
  if (!words || words.length === 0) return undefined;

  const usable = words.filter((word) => typeof word?.text === "string");
  if (usable.length === 0) {
    report.dropped += 1;
    return undefined;
  }

  const repaired = normalise(usable, report).entries;

  const clamped: TranscriptWord[] = [];
  for (const word of repaired) {
    const start = Math.min(Math.max(word.start, line.start), line.end);
    const end = Math.min(Math.max(word.end, start + MIN_SPAN_SECONDS), line.end);
    // Counted, because an uncounted repair is a discarded one: `clean` decides
    // whether the repaired copy is returned at all, so a clamp that leaves the
    // report untouched is computed and then thrown away in favour of the
    // original. That was the first version's bug, and it was silent — the
    // function did the right thing and returned the wrong value.
    if (start !== word.start || end !== word.end) report.clamped += 1;

    // A word clamped to zero width at the very end of the line carries no
    // information the fill can use, and would divide by zero if kept.
    if (end <= start) {
      report.degenerate += 1;
      continue;
    }
    clamped.push({ start, end, text: word.text });
  }

  return clamped.length > 0 ? clamped : undefined;
}

/**
 * Validates and repairs a transcript, returning a timeline safe to synchronise
 * against.
 *
 * `clean` is the useful part of the result for callers that already hold the
 * input: an untouched transcript is returned as `clean: true` so it can be
 * stored or rendered by reference, with no copy and no cache invalidation.
 */
export function repairTranscript(
  segments: readonly TranscriptSegment[] | null | undefined,
): IntegrityResult {
  const report: IntegrityReport = {
    dropped: 0,
    reordered: 0,
    overlaps: 0,
    invalid: 0,
    degenerate: 0,
    duplicates: 0,
    clamped: 0,
  };

  if (!segments || segments.length === 0) {
    return { segments: [], report, clean: true };
  }

  const usable = segments.filter((segment) => {
    const ok = typeof segment?.text === "string" && segment.text.trim().length > 0;
    if (!ok) report.dropped += 1;
    return ok;
  });

  const { entries: lines, sorted } = normalise(usable, report);

  const repaired = lines.map((line) => ({
    ...line,
    words: repairWords(line.words, line, report),
  }));

  // `sorted` counts towards this even though it damaged nothing: `clean`
  // decides whether the repaired copy is returned at all, so a transcript that
  // only needed reordering would otherwise be re-sorted and then handed back in
  // its original order. Found by the test for exactly that case.
  const clean = !hasDefects(report) && !sorted;

  return {
    segments: clean ? (segments as TranscriptSegment[]) : repaired,
    report,
    clean,
  };
}

/**
 * True when anything at all was wrong.
 *
 * Also what decides `clean`, and therefore whether the repaired copy is
 * returned instead of the input. Every counter must be listed: one omitted here
 * is a whole class of repair that gets computed and silently discarded. Summing
 * the values rather than naming them means a counter added later is covered by
 * default, which is the safe direction to fail.
 */
export function hasDefects(report: IntegrityReport): boolean {
  return Object.values(report).some((count) => count > 0);
}
