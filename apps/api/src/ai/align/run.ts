/**
 * Working out where a publisher's cues actually belong in the audio we serve.
 *
 * The whole feature, orchestrated: measure the file, sample a few seconds of it
 * in a handful of places, find those seconds in the publisher's transcript, and
 * fit a staircase to the differences. What comes out is a correction that can be
 * applied to every cue, or nothing at all.
 *
 * **Why it samples instead of transcribing.** Transcribing the episode would
 * answer the question completely and cost fifty minutes of Whisper time per
 * episode, which on a shared free tier is the difference between a feature that
 * exists and one that does not. Four twenty-four-second windows cost about a
 * hundred seconds and answer it well enough to put every cue within a second.
 *
 * **Why it stops early.** Most episodes carry a single pre-roll — measured on
 * two Elevation episodes, both were an identical 8.693s — and for those the
 * correction is one number. Three probes that agree prove that, and there is
 * nothing further to learn by taking a fourth. Probes are only spent where
 * anchors *disagree*, which is exactly where an ad break must be.
 */

import { episodes, transcripts, type TranscriptRow } from '@cue/db';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { keyFor } from '../access.ts';
import { transcribe } from '../groq.ts';
import { canAlign } from '@cue/core';
import type { Transcript } from '@cue/types';
import { isTimed } from '../../feed/transcript.ts';
import { findAnchor, indexReference, referenceTokens } from './anchor.ts';
import { insertedAudio, readAudioShape, type AudioShape } from './detect.ts';
import { buildOffsetMap, STEP_TOLERANCE_MS, type Anchor, type OffsetMap } from './map.ts';
import { fetchProbe, hypothesisTokens, type Probe } from './probe.ts';

/**
 * How much audio each probe carries.
 *
 * Long enough to contain a few sentences that are unique in the episode — the
 * three-word seeding needs a run of clean speech to vote with, and a five-second
 * clip of someone saying "and so, you know" votes for everywhere at once. Short
 * enough that a dozen of them is still a rounding error against transcribing the
 * file. At 128kbps this is 384KB.
 */
const WINDOW_MS = 24_000;

/**
 * Where the first probes go, as fractions of the served duration.
 *
 * Not 0 and not 1. The opening of a podcast is where the pre-roll is, so a probe
 * there is likely to land in an advertisement and match nothing; the very end is
 * outro music and post-roll for the same reason. These three span the body of
 * the episode, which is what the transcript covers.
 */
const FIRST_PASS = [0.12, 0.5, 0.85];

/** Probes to try if the first pass produced too few anchors to fit anything. */
const SECOND_PASS = [0.3, 0.68, 0.05];

/**
 * Total probes one alignment may spend.
 *
 * A ceiling rather than a target. Three is the common case; this bounds the
 * pathological one — an episode with many breaks, or a transcript that keeps
 * failing to match — so a single job cannot quietly consume an hour of the
 * shared allowance.
 */
const MAX_PROBES = 12;

/**
 * How precisely an insertion point is worth locating, in transcript time.
 *
 * Bisecting stops here. Below this the cues on either side of the estimated
 * boundary are out by less than the gap between two lines, so further probes buy
 * accuracy nobody can see while spending quota that is genuinely scarce.
 */
const BRACKET_TARGET_MS = 45_000;

/** Below this the file matches the cues and nothing needs correcting. */
const IN_SYNC_MS = 2_000;

export type StoredAlignment = {
  steps: OffsetMap['steps'];
  anchors: Anchor[];
  confidence: number;
  /** How many probes were spent reaching it. */
  probes: number;
  /**
   * The served duration this was computed against.
   *
   * Kept so a listener whose own copy is a different length can be told that the
   * correction was derived from a different cut — ad stitching is per request,
   * and a listener in another country is not served the file this measured.
   */
  audioDurationMs: number;
  at: string;
};

export type AlignOutcome =
  | { status: 'aligned'; alignment: StoredAlignment }
  /** The file matches the cues already. Nothing to do, and nothing was spent. */
  | { status: 'in-sync'; insertedMs: number }
  /** Cannot be measured: not constant-bitrate MP3, or the CDN would not say. */
  | { status: 'unmeasurable'; detail: string }
  /** Measured and probed, and the probes did not agree on anything. */
  | { status: 'inconclusive'; detail: string; probes: number }
  | { status: 'failed'; detail: string };

/** Server timestamp text retains microseconds that the Date mapper discards. */
export type VersionedTranscriptRow = TranscriptRow & {
  fetchedAtVersion: string;
};

/**
 * Align one episode's publisher transcript against the audio.
 *
 * Callers are responsible for the quota; this spends between three and twelve
 * Whisper requests on windows of `WINDOW_MS` and does not meter them itself.
 */
export async function alignEpisode(
  app: FastifyInstance,
  episodeId: string,
  userId: string,
  options: {
    funding: 'byok' | 'operator';
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<AlignOutcome> {
  const [episode] = await app.db.select().from(episodes).where(eq(episodes.id, episodeId)).limit(1);

  if (!episode) return { status: 'failed', detail: 'No such episode' };

  const [row] = await app.db
    .select({
      ...getTableColumns(transcripts),
      fetchedAtVersion: sql<string>`to_char(${transcripts.fetchedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(transcripts)
    .where(eq(transcripts.episodeId, episodeId))
    .limit(1);

  if (!row || row.status !== 'ready' || row.segments.length === 0) {
    return { status: 'failed', detail: 'There is no transcript to align' };
  }

  /**
   * The same rule the client uses to decide whether to offer the button.
   *
   * Re-asked here rather than trusted, because the client is not the only thing
   * that can reach this endpoint and because the row may have changed since the
   * page was rendered — a generated transcript can land on an episode whose
   * publisher captions were showing a moment ago.
   */
  const shapeOfRow = {
    // `source` is a plain text column in the database and a union on the wire;
    // the cast is the one place that boundary is crossed, and the check below is
    // what makes it safe rather than assumed.
    source: row.source as Transcript['source'],
    timed: isTimed(row.segments),
    aligned: false,
  };

  if (!canAlign(shapeOfRow)) {
    return {
      status: 'failed',
      detail:
        row.source !== 'feed'
          ? 'Only publisher transcripts need aligning'
          : 'This transcript has no timings to correct',
    };
  }

  const shape = await readAudioShape(episode.audioUrl, options);
  if (shape.status === 'error') return { status: 'failed', detail: shape.detail };
  if (shape.status === 'unreadable') {
    return { status: 'unmeasurable', detail: shape.detail };
  }
  if (!shape.constantBitrate || shape.durationMs === null) {
    return {
      status: 'unmeasurable',
      detail: 'This episode is not constant-bitrate audio, so its timings cannot be measured',
    };
  }

  /**
   * Skip the work when the byte counts already agree.
   *
   * This is free and it is the common case across the catalogue as a whole —
   * most shows insert nothing. Spending Whisper to confirm that a file which is
   * exactly the declared length is exactly the declared length would be the most
   * expensive way possible to learn nothing.
   */
  const inserted = insertedAudio(shape, episode.audioLengthBytes);
  if (inserted && Math.abs(inserted.insertedMs) < IN_SYNC_MS) {
    return { status: 'in-sync', insertedMs: inserted.insertedMs };
  }

  const index = indexReference(referenceTokens(row.segments));
  if (index.tokens.length === 0) {
    return {
      status: 'failed',
      detail: 'This transcript has no words to match',
    };
  }

  const funding = await keyFor(app, userId, options.funding);
  const duration = shape.durationMs;
  const anchors: Anchor[] = [];
  const attempted = new Set<number>();
  let probes = 0;

  /**
   * One probe: fetch the window, transcribe it, find it in the transcript.
   *
   * Returns whether an anchor came back. A miss is not an error — a probe that
   * lands inside an advertisement is transcribing words that are genuinely not
   * in the publisher's file, and the honest result is no anchor.
   */
  const probeAt = async (atMs: number): Promise<boolean> => {
    const rounded = Math.round(atMs);
    if (attempted.has(rounded) || probes >= MAX_PROBES) return false;
    attempted.add(rounded);

    const window = await fetchProbe(episode.audioUrl, shape, rounded, WINDOW_MS, options);
    if (!window || 'status' in window) return false;

    probes += 1;
    options.onProgress?.(probes, MAX_PROBES);

    const heard = await transcribeProbe(funding, window, options.signal);
    if (!heard) return false;

    const anchor = findAnchor(index, hypothesisTokens(heard, window.startMs));
    if (!anchor) return false;

    anchors.push(anchor);
    return true;
  };

  for (const fraction of FIRST_PASS) await probeAt(duration * fraction);

  if (anchors.length < 2) {
    for (const fraction of SECOND_PASS) {
      await probeAt(duration * fraction);
      if (anchors.length >= 2) break;
    }
  }

  if (anchors.length < 2) {
    return {
      status: 'inconclusive',
      detail: 'Could not find enough of the transcript in the audio to place it',
      probes,
    };
  }

  /**
   * Spend the remaining budget only where anchors disagree.
   *
   * Two anchors with different offsets bracket an insertion, and the only thing
   * worth knowing next is where inside that bracket it happened. Probing the
   * midpoint halves the uncertainty each time; probing anywhere else re-measures
   * something already known.
   */
  while (probes < MAX_PROBES) {
    const gap = widestDisagreement(anchors);
    if (!gap) break;

    if (!(await probeAt((gap.low.audioMs + gap.high.audioMs) / 2))) break;
  }

  const map = buildOffsetMap(anchors);
  if (!map) {
    return {
      status: 'inconclusive',
      detail: 'The samples did not agree on a consistent timeline',
      probes,
    };
  }

  const alignment: StoredAlignment = {
    steps: map.steps,
    anchors: map.anchors,
    confidence: map.confidence,
    probes,
    audioDurationMs: duration,
    at: new Date().toISOString(),
  };
  if (!(await saveAlignment(app, row, alignment))) {
    return {
      status: 'failed',
      detail: 'The transcript changed while its alignment was running. Try again.',
    };
  }
  return {
    status: 'aligned',
    alignment,
  };
}

/** Publish only against the exact publisher cues measured by this attempt. */
export async function saveAlignment(
  app: FastifyInstance,
  observed: VersionedTranscriptRow,
  alignment: StoredAlignment,
): Promise<boolean> {
  const changed = await app.db
    .update(transcripts)
    .set({ alignment })
    .where(
      and(
        eq(transcripts.episodeId, observed.episodeId),
        eq(transcripts.source, 'feed'),
        eq(transcripts.status, 'ready'),
        sql`${transcripts.fetchedAt} = ${observed.fetchedAtVersion}::timestamptz`,
        eq(transcripts.revision, observed.revision),
        eq(transcripts.segments, observed.segments),
      ),
    )
    .returning({ id: transcripts.episodeId });
  return changed.length === 1;
}

/**
 * The adjacent pair that disagrees across the widest span of audio.
 *
 * Widest rather than first, so the budget goes to the least-known region. Pairs
 * already narrowed below `BRACKET_TARGET_MS` are ignored — their insertion point
 * is located well enough — which is also what ends the loop.
 */
function widestDisagreement(anchors: readonly Anchor[]): { low: Anchor; high: Anchor } | null {
  const sorted = [...anchors].sort((a, b) => a.audioMs - b.audioMs);

  let best: { low: Anchor; high: Anchor } | null = null;
  let widest = BRACKET_TARGET_MS;

  for (let i = 1; i < sorted.length; i += 1) {
    const low = sorted[i - 1]!;
    const high = sorted[i]!;

    const offsetGap = Math.abs(high.audioMs - high.transcriptMs - (low.audioMs - low.transcriptMs));
    if (offsetGap <= STEP_TOLERANCE_MS) continue;

    const span = high.audioMs - low.audioMs;
    if (span > widest) {
      widest = span;
      best = { low, high };
    }
  }

  return best;
}

/**
 * Hand one window to Whisper.
 *
 * Failures are swallowed into null on purpose. A probe is one sample of several
 * and the alignment can be fitted without it, so a single upload that hits a
 * rate limit or a transient provider error should cost that sample rather than
 * the whole job — which has already paid for a redirect walk and a download per
 * probe taken so far.
 */
async function transcribeProbe(
  funding: { key: string; byok: boolean },
  probe: Probe,
  signal: AbortSignal | undefined,
) {
  try {
    return await transcribe({
      key: funding.key,
      byok: funding.byok,
      bytes: probe.bytes,
      filename: 'probe.mp3',
      ...(signal ? { signal } : {}),
    });
  } catch {
    return null;
  }
}

export type { AudioShape };
