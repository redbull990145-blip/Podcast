'use client';

import { useEffect, useState } from 'react';

/**
 * A value that lags behind, on purpose.
 *
 * Search used `useDeferredValue`, which is a different tool for a
 * similar-looking problem. Deferring keeps the *input* responsive by rendering
 * the results at a lower priority — but React still hands over the newest
 * value the moment it is idle, which on a fast machine is every keystroke. So
 * typing "planet money" fired eleven requests at a rate-limited directory and
 * threw ten of the answers away.
 *
 * This waits for the typing to stop instead. The timer is cleared on every
 * change, so a run of keystrokes produces exactly one settled value — and the
 * cleanup means an unmount mid-type cannot leave a pending update behind.
 *
 * Nothing here cancels the request that is already running: that is
 * TanStack Query's job, via the `AbortSignal` it hands the query function, and
 * doing it in two places is how you end up aborting the one you wanted.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
