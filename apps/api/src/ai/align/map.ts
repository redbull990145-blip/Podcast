/**
 * Turning a handful of measured anchors into a correction for every cue.
 *
 * The shape of the problem decides the shape of the answer. Ads are *inserted*
 * into a master, never spread through it, so the error a listener experiences is
 * not drift and not a stretch: it is a step function. Everything before the first
 * insertion is perfectly in sync, everything between the first and second is out
 * by exactly the length of the first ad, and so on. That is why this fits a
 * staircase rather than a line — and why scaling the clock by the ratio of two
 * durations, the obvious cheap fix, is wrong everywhere except by coincidence.
 * `caption-sync.ts` makes the same argument from the other side.
 *
 * Two properties are enforced rather than hoped for:
 *
 *  - **Monotonic.** Inserted audio can only push a cue later. An anchor set
 *    implying that some passage arrives *earlier* than the transcript says is
 *    describing something other than ad insertion — a bad text match, most
 *    likely — and is refused rather than smoothed over.
 *  - **Refusable.** Every function here can return null. A transcript that is
 *    merely out of sync is a known, explicable annoyance with a manual control
 *    next to it; a transcript confidently re-timed to the wrong places is worse
 *    than the problem, because there is nothing left for the reader to argue
 *    with.
 */

import type { TranscriptSegment } from '@cue/types';

/** One measured correspondence between the served audio and the transcript. */
export type Anchor = {
  /** Where this passage is in the file the listener is served. */
  audioMs: number;
  /** Where the publisher's transcript puts the same passage. */
  transcriptMs: number;
  /** 0..1, how well the recognised words matched the transcript's. */
  similarity: number;
};

/**
 * One tread of the staircase: from `fromTranscriptMs` onward, add `offsetMs`.
 *
 * Boundaries are expressed in *transcript* time because that is what the cues
 * are stamped in and therefore what has to be looked up. Expressing them in
 * audio time would mean solving for the offset in order to find the offset.
 */
export type OffsetStep = {
  fromTranscriptMs: number;
  offsetMs: number;
  /**
   * The window the insertion is known to lie within, in transcript time.
   *
   * Kept because the boundary itself is an estimate — a midpoint between the two
   * anchors that disagreed — and the honest width of that estimate is the gap
   * between them. Cues inside the bracket are the ones this map is least sure
   * about, which is worth being able to say later without re-deriving it.
   */
  bracketMs: [number, number];
};

export type OffsetMap = {
  /** Ascending by `fromTranscriptMs`. Always opens with a step at 0. */
  steps: OffsetStep[];
  /** Anchors that survived filtering and produced it. */
  anchors: Anchor[];
  /** Mean similarity of those anchors, 0..1. */
  confidence: number;
};

/**
 * How far apart two offsets must be to count as different treads.
 *
 * Well above the noise floor and well below a real ad. An anchor's audio time is
 * exact — it is byte arithmetic on a constant-bitrate file — but its transcript
 * time comes from matching recognised words against cues that are themselves only
 * accurate to a cue, so a second of disagreement between two anchors on the same
 * tread is ordinary. The shortest ad anyone sells is fifteen seconds, so nothing
 * real lives in the gap between this and that.
 */
export const STEP_TOLERANCE_MS = 1500;

/**
 * How much backwards movement is absorbed as measurement noise.
 *
 * Deliberately the same figure. A little apparent regression between adjacent
 * anchors is the cue-level quantisation above; a large one means the anchors do
 * not describe a single monotonic timeline, and no staircase should be fitted to
 * them at all.
 */
export const BACKWARD_TOLERANCE_MS = STEP_TOLERANCE_MS;

/** Below this, a text match is not evidence of anything. */
export const MIN_SIMILARITY = 0.55;

/** Fewer than this and there is no timeline, only a guess. */
export const MIN_ANCHORS = 2;

/**
 * Fit a staircase to the anchors, or decline to.
 *
 * Null means "do not re-time this transcript", and the caller must treat that as
 * a complete answer rather than a reason to fall back to something rougher.
 */
export function buildOffsetMap(
  anchors: readonly Anchor[],
  options: { minSimilarity?: number; stepToleranceMs?: number } = {},
): OffsetMap | null {
  const minSimilarity = options.minSimilarity ?? MIN_SIMILARITY;
  const tolerance = options.stepToleranceMs ?? STEP_TOLERANCE_MS;

  const usable = anchors
    .filter((anchor) => anchor.similarity >= minSimilarity)
    .slice()
    .sort((a, b) => a.transcriptMs - b.transcriptMs);

  if (usable.length < MIN_ANCHORS) return null;

  const offsets = usable.map((anchor) => anchor.audioMs - anchor.transcriptMs);

  /**
   * Reject the whole set on any real regression.
   *
   * Compared against the running maximum rather than against the previous
   * anchor: three anchors reading 9s, 9s, 4s describe a contradiction even
   * though no single adjacent pair moves backwards by much, and comparing
   * pairwise would let that through as two small steps.
   */
  let highest = offsets[0]!;
  for (const offset of offsets) {
    if (offset < highest - BACKWARD_TOLERANCE_MS) return null;
    if (offset > highest) highest = offset;
  }

  /**
   * Group runs of anchors that agree, and put a step between the runs.
   *
   * The representative offset for a run is its *median*, not its mean: one
   * anchor that matched the wrong repeated phrase should move the answer by
   * nothing rather than by a share of its error.
   */
  const steps: OffsetStep[] = [];
  let runStart = 0;

  const flush = (endExclusive: number, bracket: [number, number]) => {
    const run = offsets.slice(runStart, endExclusive).sort((a, b) => a - b);
    const median = run[Math.floor(run.length / 2)]!;

    steps.push({
      fromTranscriptMs: steps.length === 0 ? 0 : Math.round((bracket[0] + bracket[1]) / 2),
      offsetMs: Math.round(median),
      bracketMs: bracket,
    });
  };

  for (let i = 1; i <= usable.length; i += 1) {
    const ended = i === usable.length;

    // A new tread starts where this anchor's offset leaves the current run's.
    const runOffset = offsets[runStart]!;
    const diverged = !ended && Math.abs(offsets[i]! - runOffset) > tolerance;

    if (ended || diverged) {
      const previousBracket: [number, number] =
        steps.length === 0
          ? [0, 0]
          : [usable[runStart - 1]!.transcriptMs, usable[runStart]!.transcriptMs];

      flush(i, previousBracket);
      runStart = i;
    }
  }

  const confidence =
    usable.reduce((sum, anchor) => sum + anchor.similarity, 0) / usable.length;

  return { steps, anchors: usable, confidence };
}

/**
 * The correction that applies at a given transcript time.
 *
 * Rightmost step whose boundary is at or before the time asked about — the same
 * shape as `activeSegmentIndex`, and a linear scan rather than a binary search
 * because a staircase with more than a handful of treads would already have been
 * refused as implausible.
 */
export function offsetAt(map: OffsetMap, transcriptMs: number): number {
  let offset = 0;
  for (const step of map.steps) {
    if (step.fromTranscriptMs > transcriptMs) break;
    offset = step.offsetMs;
  }
  return offset;
}

/** Where a transcript timestamp lands in the audio a listener is served. */
export function toAudioMs(map: OffsetMap, transcriptMs: number): number {
  return transcriptMs + offsetAt(map, transcriptMs);
}

/**
 * Re-time every cue.
 *
 * Start and end are mapped independently, which matters only for the one cue
 * that straddles an insertion: its start takes the offset before the ad and its
 * end the offset after, so it stretches across the break instead of jumping
 * over it. That is the truthful rendering — the words really were interrupted —
 * and it leaves the following cue with a gap in front of it, which is what
 * `gapBefore` already draws as silence.
 *
 * Ends are floored at their own starts so a pathological map can never produce a
 * cue that finishes before it begins; `parseTranscript` drops those on the way
 * in and nothing downstream expects to meet one.
 */
export function applyOffsetMap<T extends TranscriptSegment>(
  segments: readonly T[],
  map: OffsetMap,
): T[] {
  return segments.map((segment) => {
    const startMs = Math.max(0, Math.round(toAudioMs(map, segment.startMs)));
    const endMs = Math.max(startMs, Math.round(toAudioMs(map, segment.endMs)));

    const words = segment.words?.map((word) => {
      const wordStart = Math.max(0, Math.round(toAudioMs(map, word.startMs)));
      return {
        ...word,
        startMs: wordStart,
        endMs: Math.max(wordStart, Math.round(toAudioMs(map, word.endMs))),
      };
    });

    return {
      ...segment,
      startMs,
      endMs,
      ...(words ? { words } : {}),
    };
  });
}
