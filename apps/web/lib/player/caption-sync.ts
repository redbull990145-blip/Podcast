'use client';

import { useSyncExternalStore } from 'react';

/**
 * Nudging the captions into line with the audio.
 *
 * **Why this has to exist at all.** Podcast enclosures are stitched per
 * request. The copy of an episode this server fetched and transcribed and the
 * copy a listener is being served are routinely different files — same show,
 * same episode, different ad load, inserted in different places. On one
 * measured episode the feed declared 2416s, the browser was served 2596s and
 * the transcribed copy ran 2622s, which left every cue after the first ad break
 * about 26 seconds out. No amount of care in the timing code can fix that,
 * because the timings are correct; they are correct about a different file.
 *
 * **Why it is a manual nudge rather than an automatic correction.** Knowing the
 * two durations tells you *that* they differ, not *where* the difference went.
 * A single pre-roll of a different length is a constant offset; three mid-rolls
 * are something closer to a stretch; a listener in another country gets neither.
 * Scaling the clock by the ratio of the durations would be exactly right for one
 * of those cases and confidently wrong for the others — a precise-looking lie,
 * which is the one thing the transcript code consistently refuses to produce
 * (see the note in `words.ts` about estimated word timings).
 *
 * So the app detects the mismatch, says so, and hands over a control. Two taps
 * and it is right, and it stays right — which is better than a correction that
 * is silently wrong and cannot be argued with.
 *
 * **Per episode, not global.** The offset is a property of the cut of the audio
 * this listener was served, so it means nothing on the next episode. Storing it
 * globally would carry one episode's ad load onto every other.
 */

const KEY = 'cue.caption-offset';

/**
 * How far the control can be pushed, in ms.
 *
 * Two minutes either way. Generous, because the thing being corrected for is an
 * ad break, and a stacked pre-roll plus two mid-rolls can run well past a
 * minute — a ceiling that cannot reach the real error is a control that appears
 * to be broken. Bounded at all so that a stored value from a corrupted write
 * cannot push every cue outside the episode.
 */
export const OFFSET_LIMIT_MS = 120_000;

/** One press. Coarse enough to matter, fine enough to land on. */
export const OFFSET_STEP_MS = 500;

/**
 * How far apart two durations must be before the mismatch is worth mentioning.
 *
 * MP3 frame-walking and the browser's own duration reporting disagree by
 * fractions of a second on identical files, and a transcript is not usefully
 * out of sync at two seconds. Below this the difference is measurement noise;
 * above it, something was inserted.
 */
export const DRIFT_TOLERANCE_MS = 2500;

type Offsets = Record<string, number>;

let cache: Offsets | null = null;
const listeners = new Set<() => void>();

function read(): Offsets {
  if (cache) return cache;

  try {
    const stored = window.localStorage.getItem(KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : {};

    // Whatever wrote this is a previous version of the app writing to a store
    // the user can edit, so every entry is checked rather than trusted.
    cache = {};
    if (parsed && typeof parsed === 'object') {
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          cache[id] = clamp(value);
        }
      }
    }
  } catch {
    cache = {};
  }

  return cache;
}

function clamp(ms: number): number {
  return Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, Math.round(ms)));
}

/**
 * The correction for one episode, in ms. Positive means the captions were
 * running behind and are being pulled forward.
 */
export function captionOffsetMs(episodeId: string | null): number {
  if (!episodeId || typeof window === 'undefined') return 0;
  return read()[episodeId] ?? 0;
}

export function setCaptionOffsetMs(episodeId: string, ms: number): void {
  const next = clamp(ms);
  const offsets = read();

  // Zero is the default, so it is stored as *absence*. Otherwise every episode
  // anyone ever opened the control on would accumulate an entry forever.
  if (next === 0) delete offsets[episodeId];
  else offsets[episodeId] = next;

  try {
    window.localStorage.setItem(KEY, JSON.stringify(offsets));
  } catch {
    // Private mode or a full quota. The offset still applies for this session,
    // which is the part the listener is watching.
  }

  for (const listener of listeners) listener();
}

/**
 * Subscribe a component to one episode's offset.
 *
 * `useSyncExternalStore` rather than state in the panel, because the control
 * and the caption clock are in different components and both have to agree
 * within the same frame.
 */
export function useCaptionOffsetMs(episodeId: string | null): number {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => captionOffsetMs(episodeId),
    () => 0,
  );
}

/**
 * Whether the cues were timed against audio of a different length.
 *
 * Both figures have to be real before anything is claimed: `audioDurationMs` is
 * null for every publisher transcript and for anything generated before it was
 * recorded, and the engine's duration is null until metadata arrives. Unknown
 * is not the same as "they match", and reporting drift from a missing
 * measurement would put a warning on transcripts that are perfectly in sync.
 */
export function driftMs(
  transcriptAudioMs: number | null | undefined,
  playingDurationSec: number | null,
): number | null {
  if (!transcriptAudioMs || transcriptAudioMs <= 0) return null;
  if (playingDurationSec === null || !Number.isFinite(playingDurationSec)) return null;

  const difference = playingDurationSec * 1000 - transcriptAudioMs;
  return Math.abs(difference) >= DRIFT_TOLERANCE_MS ? Math.round(difference) : null;
}
