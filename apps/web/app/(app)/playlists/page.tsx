import type { Metadata } from 'next';
import { getTranslator } from '@/lib/i18n';
import { PlaylistsClient } from './playlists-client';
import { PageShell } from '@/components/ui/page-shell';

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
export default async function PlaylistsPage() {
  const t = await getTranslator();

  return (
    <PageShell>
      <h1 className="type-display mt-0 mb-8 text-[var(--color-text-primary)]">
        {t.t('playlists.title')}
      </h1>
      <PlaylistsClient />
    </PageShell>
  );
}
