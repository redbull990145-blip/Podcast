import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { getTranslator } from '@/lib/i18n';
import { LibraryClient } from './library-client';

export const metadata: Metadata = { title: 'Library' };

export default async function LibraryPage() {
  const t = await getTranslator();

  return (
    <div className="mx-auto w-full max-w-[var(--measure-content)] px-5 py-8 md:px-10 md:py-12">
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="type-display m-0 text-[var(--color-text-primary)]">Library</h1>

        {/* Playlists are reached from here rather than from the nav. The nav
            holds four destinations on purpose — every extra one is a decision
            somebody makes before they can listen to anything — and a playlist
            is part of "your shows" rather than a fifth place to be. */}
        <Link
          href={'/playlists' as Route}
          className="type-body-strong text-[var(--color-text-secondary)] no-underline decoration-transparent underline-offset-4 transition-colors hover:text-[var(--color-text-primary)] hover:underline hover:decoration-[var(--color-border-strong)]"
        >
          {t.t('nav.playlists')}
        </Link>
      </div>

      <LibraryClient />
    </div>
  );
}
