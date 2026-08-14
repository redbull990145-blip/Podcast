/**
 * The contract a platform must satisfy to play audio.
 *
 * Everything above this line is pure TypeScript — the queue, the resume rules,
 * the sleep timer — and everything below it is platform-specific: an `<audio>`
 * element on the web, `expo-audio` on Android. Neither knows about the other.
 *
 * The point of the seam is that playback logic is testable without a browser
 * and identical on both platforms. The bugs that make a podcast app feel broken
 * — losing your place, skipping the wrong way, a sleep timer that fires late —
 * live in the logic, not in the audio element, and this is what lets them be
 * caught by a unit test instead of by a user on a train.
 */

export type PlaybackStatus =
  | 'idle'
  /** A source is loading. The UI should stay responsive and show the episode. */
  | 'loading'
  | 'playing'
  | 'paused'
  /** Reached the end of the current source. */
  | 'ended'
  | 'error';

/** What the engine reports upward. Deliberately small. */
export type EngineEvent =
  | { type: 'loaded'; durationSec: number | null }
  | { type: 'position'; positionSec: number }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'ended' }
  | { type: 'stalled' }
  | { type: 'error'; message: string };

export type EngineListener = (event: EngineEvent) => void;

export interface PlaybackEngine {
  /**
   * Point the engine at a source and seek to `startAtSec` before playing.
   *
   * Seeking as part of load rather than after it matters: loading then seeking
   * plays a fraction of a second from position zero first, which is audible and
   * sounds like a glitch.
   */
  load(url: string, startAtSec: number): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(positionSec: number): void;
  /** 0.5–3.0. Implementations preserve pitch. */
  setRate(rate: number): void;
  /** 0–1. */
  setVolume(volume: number): void;
  /** Current position, read synchronously — used for the final progress write. */
  getPosition(): number;
  subscribe(listener: EngineListener): () => void;
  /** Release the underlying resource. */
  destroy(): void;
}

/**
 * Playback speed options.
 *
 * A short list, not a slider: people pick a speed once and keep it, and the
 * granularity between 1.6 and 1.65 is not a decision anyone wants to make.
 */
export const PLAYBACK_RATES = [0.8, 1, 1.2, 1.5, 1.75, 2, 2.5, 3] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

/** Seconds each skip control moves. Back is shorter than forward on purpose:
 *  you skip back to re-hear something specific and forward to escape an ad. */
export const SKIP_BACK_SEC = 15;
export const SKIP_FORWARD_SEC = 30;

/**
 * The intervals a listener may choose between.
 *
 * Both lists are short for the same reason the speed list is: this is a
 * preference someone sets once, and offering every second between 5 and 60
 * turns a decision into a chore.
 */
export const SKIP_BACK_OPTIONS = [10, 15, 30] as const;
export const SKIP_FORWARD_OPTIONS = [15, 30, 45] as const;

/**
 * Playback settings that belong to the listener rather than to an episode.
 *
 * Speed is the one people notice: it is a strong personal preference, and a
 * player that forgets it makes every session start by fixing the player.
 */
export type PlaybackPreferences = {
  rate: PlaybackRate;
  skipBackSec: number;
  skipForwardSec: number;
};

export const DEFAULT_PREFERENCES: PlaybackPreferences = {
  rate: 1,
  skipBackSec: SKIP_BACK_SEC,
  skipForwardSec: SKIP_FORWARD_SEC,
};

/**
 * Coerce stored preferences back into valid ones.
 *
 * Whatever wrote them is a previous version of this app writing to a store the
 * user can edit, so every field is checked rather than trusted. A speed of
 * `"fast"` or 47 must not reach the audio element — some platforms throw, and
 * the ones that don't play unintelligibly.
 */
export function normalizePreferences(input: unknown): PlaybackPreferences {
  const value = (input ?? {}) as Partial<Record<keyof PlaybackPreferences, unknown>>;

  const rate = PLAYBACK_RATES.find((option) => option === value.rate);
  const skipBack = SKIP_BACK_OPTIONS.find((option) => option === value.skipBackSec);
  const skipForward = SKIP_FORWARD_OPTIONS.find((option) => option === value.skipForwardSec);

  return {
    rate: rate ?? DEFAULT_PREFERENCES.rate,
    skipBackSec: skipBack ?? DEFAULT_PREFERENCES.skipBackSec,
    skipForwardSec: skipForward ?? DEFAULT_PREFERENCES.skipForwardSec,
  };
}
