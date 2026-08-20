import { useEffect, useState } from 'react';

/**
 * A value that lags behind, on purpose.
 *
 * Search used `useDeferredValue`, which is a different tool for a
 * similar-looking problem. Deferring keeps the *field* responsive by rendering
 * the results at a lower priority — but React still hands over the newest
 * value as soon as it is idle, which is very nearly every keystroke. So typing
 * a show's name fired a request per letter at a rate-limited directory, over a
 * phone connection, and threw all but the last answer away.
 *
 * This waits for the typing to stop instead. The timer is cleared on every
 * change, so a run of keystrokes settles exactly once — and the cleanup means
 * leaving the screen mid-type cannot leave a pending update behind.
 *
 * Nothing here cancels the request already in flight: that is TanStack Query's
 * job, and doing it in two places is how you abort the one you wanted.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
