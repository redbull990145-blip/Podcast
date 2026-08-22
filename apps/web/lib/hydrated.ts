'use client';

import { useSyncExternalStore } from 'react';

/** Nothing to subscribe to: the answer changes exactly once, at hydration. */
const subscribe = () => () => {};

/**
 * `false` on the server and during the first client render; `true` afterwards.
 *
 * The tool for rendering something the server cannot know. React requires the
 * first client render to produce the markup the server sent — that is the whole
 * mechanism by which hydration attaches to existing DOM instead of rebuilding
 * it — so any value that only exists in the browser has to be *absent* from
 * that first render and applied on the next one.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, because it says
 * this directly: the third argument is the server snapshot, and React uses it
 * for SSR and for hydration both. The effect version arrives at the same answer
 * by rendering, committing, and then correcting itself, which works and reads
 * as a workaround for a rule rather than a use of it.
 *
 * This is not a licence to defer anything inconvenient to the client. Content
 * belongs in the server render; this is for facts about *this browser* —
 * whether a session cookie resolved to an account, what the viewport is, what
 * the local clock says.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
