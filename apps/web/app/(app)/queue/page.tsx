import type { Metadata } from 'next';
import { QueueClient } from './queue-client';

// The root layout's template appends "· Cue"; passing it here too would
// produce "Queue · Cue · Cue".
export const metadata: Metadata = { title: 'Queue' };

/**
 * The queue.
 *
 * Entirely client-rendered, unlike the catalogue pages: this is one listener's
 * private running order, it changes as they play, and there is nothing here
 * for a search engine to index or a stranger to land on.
 */
export default function QueuePage() {
  return <QueueClient />;
}
