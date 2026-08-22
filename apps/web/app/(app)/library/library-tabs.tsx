'use client';

import type { PlaylistKind } from '@cue/types';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslator } from '@/components/i18n/locale-provider';
import { PlaylistGrid } from '@/components/playlist/playlist-grid';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/session';
import { LibraryClient } from './library-client';

/**
 * The Library, in two sections.
 *
 * Shows and playlists are both "things you keep", which is why they belong on
 * one screen rather than behind a fifth nav destination — the nav holds four on
 * purpose, and every extra one is a decision somebody makes before they can
 * listen to anything.
 *
 * The section lives in the URL rather than in component state. A playlist you
 * were looking at is a place, and a place has to survive a reload, a back
 * button, and being sent to someone — none of which `useState` gives.
 */
const SECTIONS = ['shows', 'episode', 'podcast'] as const;
type Section = (typeof SECTIONS)[number];

function sectionFrom(value: string | null): Section {
  return SECTIONS.includes(value as Section) ? (value as Section) : 'shows';
}

export function LibraryTabs() {
  const t = useTranslator();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { isSignedIn, isLoading } = useSession();

  const section = sectionFrom(params.get('view'));

  const go = (next: Section) => {
    // `replace`, not `push`: flicking between two tabs is not three places you
    // want the back button to walk you through in reverse.
    const query = next === 'shows' ? '' : `?view=${next}`;
    router.replace(`${pathname}${query}` as Route, { scroll: false });
  };

  const tabs: { id: Section; label: string }[] = [
    { id: 'shows', label: t.t('library.tabShows') },
    { id: 'episode', label: t.t('playlists.kindEpisode') },
    { id: 'podcast', label: t.t('playlists.kindPodcast') },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/*
        A tablist, not a row of links styled like one. The distinction is what
        makes the arrow keys work and what tells a screen reader that these
        three control one region rather than navigating away.
      */}
      <div
        role="tablist"
        aria-label={t.t('nav.library')}
        className="-mx-1 flex gap-1 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const selected = section === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              // Only the selected tab is in the tab order; the arrow keys move
              // between them from there. A tablist where Tab walks every tab is
              // a tablist that has to be tabbed past to reach its own content.
              tabIndex={selected ? 0 : -1}
              onClick={() => go(tab.id)}
              onKeyDown={(event) => {
                const delta =
                  event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                if (delta === 0) return;
                event.preventDefault();
                const index = tabs.findIndex((entry) => entry.id === section);
                // Wraps, which is what the pattern specifies and what a person
                // pressing Right at the end expects rather than a dead key.
                const next = tabs[(index + delta + tabs.length) % tabs.length];
                if (next) go(next.id);
              }}
              className={`type-body-strong relative min-h-11 shrink-0 cursor-pointer rounded-full border-none bg-transparent px-4 transition-colors ${
                selected
                  ? 'text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {tab.label}
              {selected ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-4 -bottom-px h-0.5 rounded-full bg-[var(--color-text-primary)]"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {section === 'shows' ? (
          <LibraryClient />
        ) : isLoading ? null : isSignedIn ? (
          <PlaylistGrid kind={section satisfies PlaylistKind} />
        ) : (
          <SignedOut />
        )}
      </div>
    </div>
  );
}

/**
 * Playlists are signed-in only, and honestly so.
 *
 * A playlist is a thing you build over weeks and expect to still be there —
 * keeping one in local storage until the browser decides otherwise would be
 * worse than saying it needs an account.
 */
function SignedOut() {
  const t = useTranslator();

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
