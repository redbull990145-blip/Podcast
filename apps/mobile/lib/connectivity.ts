import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';
import { useSyncExternalStore } from 'react';
import { downloadActions } from '@/lib/downloads/store';

/**
 * Whether this handset can reach anything.
 *
 * A singleton rather than a hook, because the two things that most need the
 * answer — the download queue and the progress outbox — live outside React and
 * cannot ask a component. The hook below is a view onto it, not the source.
 *
 * Worth being precise about what "online" means here. Android distinguishes
 * *connected* from *validated*: a phone attached to a hotel Wi-Fi that has not
 * been paid for is connected and reaches nothing. `isInternetReachable` is the
 * validated one, and it is what we use where the platform provides it.
 */

let online = true;
let started = false;

const listeners = new Set<() => void>();

/**
 * Undefined means the platform has not decided yet, and that is not the same as
 * offline. Assuming the worst on an unknown would suppress requests that would
 * have worked — including the resume lookup someone gets when they open the app
 * and immediately press play.
 */
function readable(state: NetworkState): boolean {
  return state.isInternetReachable ?? state.isConnected ?? true;
}

function apply(next: boolean): void {
  if (online === next) return;
  online = next;

  // The download queue waits rather than failing while offline, so it needs
  // telling in both directions: this is what makes a queue built on the train
  // finish itself at the front door.
  downloadActions.setOnline(next);

  for (const listener of listeners) listener();
}

/**
 * Begin watching, once.
 *
 * The listener fires on change, which means nothing at all is known until the
 * first change happens — so the current state is asked for once, up front. On a
 * phone that launches in airplane mode, that first read is the only signal
 * there will be.
 */
function start(): void {
  if (started) return;
  started = true;

  void getNetworkStateAsync()
    .then((state) => {
      apply(readable(state));
    })
    .catch(() => {
      // The module refused to answer. Optimistic is the right default: every
      // request already handles its own failure, and pessimism would disable
      // half the app over a module that did not load.
    });

  addNetworkStateListener((state) => {
    apply(readable(state));
  });
}

/** For code outside React — the player, the outbox, the download queue. */
export function isOnline(): boolean {
  start();
  return online;
}

/** Subscribe to connectivity changes outside React. */
export function subscribeConnectivity(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For components: `true` when there is a usable connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeConnectivity, isOnline);
}
