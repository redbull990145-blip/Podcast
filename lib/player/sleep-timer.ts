/**
 * Adjusting a running sleep timer.
 *
 * Its own module because the unit conversion here is a trap. The store's
 * `setSleepTimer` takes **minutes from now** — that is what the 5m/10m/15m
 * presets pass — while the state it produces is an absolute epoch timestamp.
 * Reading the deadline, adding thirty seconds and handing the result straight
 * back therefore sets a timer for roughly fifty-six thousand years, and the UI
 * shows it: the countdown reads the epoch in milliseconds.
 */

/** Never adjust a timer to less than this; zero would stop playback outright. */
export const MIN_REMAINING_MS = 10_000;

/**
 * Minutes from `now` for a timer currently due at `deadline`, moved by
 * `deltaSeconds`.
 *
 * Returns minutes, because that is what the store expects back.
 */
export function nudgedMinutes(
  deadline: number,
  now: number,
  deltaSeconds: number,
): number {
  const remainingMs = deadline - now;
  const nextMs = Math.max(MIN_REMAINING_MS, remainingMs + deltaSeconds * 1_000);
  return nextMs / 60_000;
}
