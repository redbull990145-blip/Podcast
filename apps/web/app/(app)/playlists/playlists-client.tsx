'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslator } from '@/components/i18n/locale-provider';
import { PlaylistGrid } from '@/components/playlist/playlist-grid';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/session';

/**
 * Every playlist this listener has, both kinds, one under the other.
 *
 * The Library puts these behind tabs because it has shows to show as well and
 * three sections of tiles would be a scroll with no landmarks. Here there is
 * nothing else on the screen, so both kinds are simply present — a tab bar with
 * two tabs and nothing above them is a control that exists to be clicked before
 * anything can be read.
 *
 * Signed-in only, and honestly so. A playlist is a thing you build over weeks
 * and expect to still be there — keeping one in local storage until the browser
 * decides otherwise would be worse than saying it needs an account.
 */
export function PlaylistsClient() {
  const t = useTranslator();
  const { isSignedIn, isLoading } = useSession();

  if (isLoading) return null;

  if (!isSignedIn) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center">
        <p className="type-title3 m-0 text-[var(--color-text-primary)]">
          {t.t('playlists.signedOut')}
        </p>
        <p className="type-callout mx-auto mt-2 mb-0 max-w-[var(--measure-prose)] text-[var(--color-text-secondary)]">
          {t.t('playlists.signedOutBody')}
        </p>
        <div className="mt-5 flex justify-center">
          <Link href={'/signin' as Route} className="no-underline">
            <Button>{t.t('common.signIn')}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <section aria-labelledby="playlists-episodes">
        <h2
          id="playlists-episodes"
          className="type-title3 mt-0 mb-4 text-[var(--color-text-primary)]"
        >
          {t.t('playlists.kindEpisode')}
        </h2>
        <PlaylistGrid kind="episode" />
      </section>

      <section aria-labelledby="playlists-shows">
        <h2
          id="playlists-shows"
          className="type-title3 mt-0 mb-4 text-[var(--color-text-primary)]"
        >
          {t.t('playlists.kindPodcast')}
        </h2>
        <PlaylistGrid kind="podcast" />
      </section>
    </div>
  );
}
