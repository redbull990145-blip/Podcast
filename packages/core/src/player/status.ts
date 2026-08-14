/**
 * Turning status snapshots into engine events.
 *
 * `expo-audio` reports *state*, several times a second: a snapshot of what is
 * true right now. The machine consumes *events*: statements about what just
 * changed. Bridging the two needs a memory of the previous snapshot, and that
 * edge-detection is where the subtle bugs live — a missed `ended` and the queue
 * never advances; a `stalled` reported per tick and a two-second buffer floods
 * the UI with twenty identical events.
 *
 * It lives here, in pure TypeScript, rather than inside the Android adapter,
 * because the symptoms only appear on a device: audio that stops between
 * episodes, or a spinner that will not go away. Debugging that over a USB cable
 * is hours; a unit test is seconds. The adapter keeps only the part that
 * genuinely needs the platform — subscribing to the native player and mapping
 * its field names onto the snapshot below.
 */

import type { EngineEvent } from './engine.ts';

/**
 * One reading of the player's state.
 *
 * Field names are ours, not any SDK's. The adapter translates, so a rename in
 * the platform library cannot reach this file.
 */
export type StatusSnapshot = {
  isLoaded: boolean;
  isBuffering: boolean;
  isPlaying: boolean;
  /** Seconds. `0` means "not known yet", which is not the same as an empty episode. */
  durationSec: number;
  positionSec: number;
  /** True on the single tick where the source reached its end. */
  didJustFinish: boolean;
  error: string | null;
};

/** What the previous snapshot said, so this one can be compared against it. */
export type StatusMemory = {
  wasPlaying: boolean;
  wasLoaded: boolean;
  wasBuffering: boolean;
  lastError: string | null;
};

export const initialStatusMemory: StatusMemory = {
  wasPlaying: false,
  wasLoaded: false,
  wasBuffering: false,
  lastError: null,
};

/**
 * Compare a snapshot against the last one and say what changed.
 *
 * Pure: the caller holds the memory and passes it back in. That is what makes a
 * whole playback session expressible as a list of snapshots in a test.
 */
export function eventsFromStatus(
  status: StatusSnapshot,
  memory: StatusMemory,
): { events: EngineEvent[]; memory: StatusMemory } {
  /**
   * An error supersedes the rest of the tick. Whatever the other fields claim,
   * playback is not happening, and reporting `playing` alongside a failure
   * would leave the UI showing a pause button for audio nobody can hear.
   *
   * Compared against the last error rather than reported unconditionally: the
   * native side repeats the same string on every tick while the failure stands.
   */
  if (status.error !== null && status.error !== memory.lastError) {
    return {
      events: [{ type: 'error', message: status.error }],
      memory: { ...memory, lastError: status.error },
    };
  }

  const events: EngineEvent[] = [];
  const next: StatusMemory = {
    ...memory,
    lastError: status.error,
  };

  if (status.isLoaded && !memory.wasLoaded) {
    events.push({
      type: 'loaded',
      // Live streams and not-yet-known durations both report 0. That is
      // "unknown", not a zero-length episode — and the machine's fallback to
      // the duration the feed advertised is the better answer than claiming an
      // episode is over before it starts.
      durationSec: status.durationSec > 0 ? status.durationSec : null,
    });
  }
  next.wasLoaded = status.isLoaded;

  // Buffering is not an error and must not replace the UI with one. Reported on
  // the edge only, so a long stall does not emit the same event every tick.
  if (status.isBuffering && !memory.wasBuffering) events.push({ type: 'stalled' });
  next.wasBuffering = status.isBuffering;

  if (status.isPlaying !== memory.wasPlaying) {
    events.push({ type: status.isPlaying ? 'playing' : 'paused' });
    next.wasPlaying = status.isPlaying;
  }

  if (status.isPlaying) events.push({ type: 'position', positionSec: status.positionSec });

  /**
   * Checked last, on purpose. The machine advances the queue on `ended`, and it
   * should do so having already seen the final position of the episode that
   * just finished — otherwise the progress write for it records wherever the
   * second-to-last tick happened to land.
   */
  if (status.didJustFinish) {
    next.wasPlaying = false;
    events.push({ type: 'ended' });
  }

  return { events, memory: next };
}

/**
 * Playback failures as something a person can act on.
 *
 * The platform's own message names a codec or an HTTP status, which tells a
 * listener nothing they can use. What they can use is *whose* problem it is and
 * whether trying again is worth their time — a 404 from the publisher is not
 * going to fix itself, and a dropped connection probably will.
 */
export function describeStreamError(error: string): string {
  const text = error.toLowerCase();

  if (text.includes('404') || text.includes('not found')) {
    return 'The publisher’s audio is no longer at that address';
  }
  if (text.includes('403') || text.includes('401')) {
    return 'The publisher refused the request for this episode';
  }
  if (
    text.includes('network') ||
    text.includes('timeout') ||
    text.includes('unable to resolve host')
  ) {
    return 'Lost connection while loading this episode';
  }
  if (text.includes('unsupported') || text.includes('decoder') || text.includes('format')) {
    return 'This episode’s audio is in a format the device cannot play';
  }

  return 'This episode could not be played';
}
