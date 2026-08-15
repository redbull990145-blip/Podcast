import type { Metadata } from 'next';
import { PlaylistsClient } from './playlists-client';

// The root layout's template appends "· Cue"; repeating it here would produce
// "Playlists · Cue · Cue".
export const metadata: Metadata = { title: 'Playlists' };

/**
 * Playlists.
 *
 * Client-rendered like the queue: this is one listener's private collection, it
 * changes as they build it, and there is nothing for a search engine to index
 * or a stranger to land on.
 */
export default function PlaylistsPage() {
  return (
    <div className="mx-auto w-full max-w-[var(--measure-content)] px-5 py-8 md:px-10 md:py-12">
      <h1 className="type-display mt-0 mb-8 text-[var(--color-text-primary)]">Playlists</h1>
      <PlaylistsClient />
    </div>
  );
}
