import type { Metadata } from 'next';
import { OfflinePage } from './offline-client';

/**
 * The page shown when a route was never visited and there is no network.
 *
 * Precached by the service worker at install, which is what makes it available
 * at the one moment it is needed — a page that has to be fetched to explain
 * that fetching is impossible would only ever show the browser's error instead.
 *
 * Outside the `(app)` group deliberately: the shell's nav links all lead to
 * routes that may also be unreachable, and offering four dead ends is worse
 * than offering one honest way back.
 */
export const metadata: Metadata = {
  title: 'Offline',
};

export default function Page() {
  return <OfflinePage />;
}
