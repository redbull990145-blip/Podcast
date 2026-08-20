'use client';

import { queryKeys, staleTime } from '@cue/api-client';
import type { LibraryPodcast } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession, useSignOut } from '@/lib/session';
import { Artwork } from '@/components/media/artwork';
import { Player } from '@/components/player/player';
import { OfflineBanner } from '@/components/pwa/offline-banner';
import { ServiceWorker } from '@/components/pwa/service-worker';
import { api } from '@/lib/api';
import { hydrateQueue, setSyncState, usePlayerState } from '@/lib/player/store';
import { NavIcon } from './nav-icon';
import { useTranslator } from '@/components/i18n/locale-provider';
import { navItems, settingsItem } from './nav-items';

/**
 * The app shell.
 *
 * Persistent across navigation: the sidebar and tab bar never unmount, so
 * moving between screens replaces only the content area. That is what makes
 * navigation read as instant — there is no chrome to rebuild, and the player
 * lives here too and keeps playing straight through a route change.
 */
export function AppShell({ children }: { children: ReactNode }) {
  useSessionSync();

  return (
    <div className="min-h-dvh">
      {/* Registered from the shell rather than the root layout: there is
          nothing worth caching on the auth pages, and a worker claiming the
          page mid-sign-in is a complication with no upside. */}
      <ServiceWorker />
      <OfflineBanner />

      <SidebarNav />

      {/* Leading gutter on desktop clears the sidebar; bottom padding on
          mobile clears the tab bar so the last row is never trapped under it.
          The extra 24px is breathing room — content ending exactly at the
          bar's edge reads as clipped even when it is technically clear of it.

          `ps-`, not `pl-`. The sidebar is pinned with `start-0`, so under
          Arabic it moves to the right of the window while a physical
          `padding-left` stayed on the left — holding the rail's width open
          against an empty edge and letting the whole page run underneath the
          sidebar on the other side. Every screen in the app was affected; it
          showed up here because Home is the one that fills the width.

          The desktop figure is the player bar's 84px plus room to breathe. */}
      <main className="pb-[calc(160px+env(safe-area-inset-bottom))] md:pb-[104px] md:ps-[var(--measure-sidebar)]">
        {children}
      </main>

      {/* Outside <main>, so a route change never unmounts it and playback
          continues straight through navigation. */}
      <Player />

      <TabBar />
    </div>
  );
}

/**
 * Tell the player whether there is an account behind it.
 *
 * In the shell rather than on the queue screen for both halves: what is queued
 * decides what plays when the current episode ends, and whether progress is
 * worth reporting applies to every screen — neither can wait for someone to
 * visit a particular page.
 *
 * The player is a singleton outside React and cannot read the session itself,
 * so this is the one place that pushes it down.
 */
function useSessionSync() {
  const { isSignedIn, isLoading } = useSession();

  useEffect(() => {
    // Stay `unknown` until the answer is real. Reporting "anonymous" while the
    // request is still in flight would suppress the resume lookup for someone
    // who is in fact signed in and simply pressed play quickly.
    if (isLoading) return;
    setSyncState(isSignedIn ? 'authenticated' : 'anonymous');
  }, [isSignedIn, isLoading]);

  useEffect(() => {
    if (!isSignedIn) return;
    void hydrateQueue();
  }, [isSignedIn]);
}

function SidebarNav() {
  const pathname = usePathname();
  const t = useTranslator();
  /* How many episodes are waiting, shown against Queue. It is the one number
     in the app that changes because of something you did on another screen,
     which is exactly the kind of fact a persistent rail is for. */
  const queued = usePlayerState().queue.length;

  return (
    <aside
      className="fixed inset-y-0 start-0 z-20 hidden w-[var(--measure-sidebar)] flex-col border-e border-[var(--color-border)] px-[18px] pt-6 pb-8 md:flex"
      aria-label={t.t('nav.main')}
    >
      <Link
        href={'/' as never}
        className="mb-6 px-3 type-title3 text-[var(--color-text-primary)] no-underline"
      >
        Cue
      </Link>

      <nav>
        <ul className="flex list-none flex-col gap-0.5 p-0">
          {navItems.map((item) => (
            <li key={item.href}>
              <RailLink
                item={item}
                active={isActive(pathname, item.href)}
                badge={item.href === '/queue' ? queued : undefined}
              />
            </li>
          ))}
        </ul>
      </nav>

      {/* The shows themselves, under the four destinations.

          Not a fifth destination — Library is still where you go to *manage*
          them. This is the list, so that following a show puts it somewhere you
          can see from every screen rather than only from the one page that
          knows about it. It is the single thing that makes the rail feel like
          it belongs to a listener rather than to the app. */}
      <SidebarShows />

      {/* A hairline separates the account row from navigation: it is a
          different kind of control, and pinning it to the floor without one
          reads as an item that fell off the list. */}
      <div className="mt-auto border-t border-[var(--color-border)] pt-4">
        <RailLink
          item={settingsItem}
          active={isActive(pathname, settingsItem.href)}
        />
        <AccountStrip />
      </div>
    </aside>
  );
}

/**
 * One destination in the rail.
 *
 * The current page is marked in the accent and nothing else — no filled pill,
 * no raised surface. A rail that paints a block behind the active row makes
 * the chrome the highest-contrast shape on the screen, competing with the
 * artwork it exists to frame; a coloured word does the same job at a fraction
 * of the visual weight. Inactive rows sit at full text colour rather than
 * greyed out, because they are destinations, not disabled controls — the
 * hierarchy here is hue, not opacity.
 */
function RailLink({
  item,
  active,
  badge,
}: {
  item: (typeof navItems)[number];
  active: boolean;
  /** A count worth seeing from every screen. Absent when zero. */
  badge?: number | undefined;
}) {
  const t = useTranslator();

  return (
    <Link
      href={item.href as never}
      aria-current={active ? 'page' : undefined}
      className={[
        'flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 no-underline',
        'transition-colors',
        active
          ? 'text-[var(--color-accent-text)]'
          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]',
      ].join(' ')}
    >
      <NavIcon path={item.icon} filled={active} size={16} />
      <span className="type-body-strong">{t.t(item.label)}</span>

      {badge ? (
        <span className="type-caption ms-auto text-[var(--color-accent-text)]">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The shows you follow, in the rail.
 *
 * Signed-out or following nothing, this is absent rather than empty: a heading
 * over nothing is the app advertising a feature you have not reached, and it
 * would sit there on every screen rather than only on the one that owns it.
 *
 * Scrolls on its own so a listener with forty shows cannot push Settings and
 * the account row off the bottom of the window.
 */
function SidebarShows() {
  const t = useTranslator();
  const { isSignedIn } = useSession();

  const { data } = useQuery({
    queryKey: queryKeys.library.subscriptions(),
    queryFn: () => api.listSubscriptions({ limit: 100 }),
    enabled: isSignedIn,
    staleTime: staleTime.podcast,
  });

  const shows = data?.items ?? [];
  if (shows.length === 0) return null;

  return (
    <div className="mt-6 flex min-h-0 flex-col">
      <p className="type-overline m-0 mb-1.5 px-3 text-[var(--color-text-tertiary)]">
        {t.t('nav.yourShows')}
      </p>

      <ul className="m-0 flex list-none flex-col overflow-y-auto p-0">
        {shows.map((show) => (
          <li key={show.id}>
            <ShowLink show={show} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShowLink({ show }: { show: LibraryPodcast }) {
  const t = useTranslator();
  const unread = show.newEpisodeCount > 0;

  return (
    <Link
      href={`/podcast/${show.id}` as never}
      className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-1.5 no-underline transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <Artwork src={show.artworkUrl} alt="" size={22} />
      <span className="type-caption clamp-1 min-w-0 flex-1 text-[var(--color-text-secondary)]">
        {show.title}
      </span>

      {/* A dot, not a count. The number is on the Library row where there is
          room to read it; here it only has to answer "is there anything?", and
          a two-digit badge at this size is a smudge. */}
      {unread ? (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
          title={t.t('library.newEpisodes', { count: show.newEpisodeCount })}
        />
      ) : null}
    </Link>
  );
}

/**
 * Account state at the foot of the sidebar.
 *
 * Deliberately quiet: signing in is not the job anyone came here to do, so it
 * sits where account controls live in every desktop app rather than competing
 * with the content.
 */
function AccountStrip() {
  const { user, isLoading } = useSession();
  const signOut = useSignOut();

  // Reserve the row's height while the session resolves; a control that pops
  // in afterwards shifts the sidebar under the cursor.
  if (isLoading) return <div aria-hidden="true" className="h-[44px]" />;

  if (!user) {
    return (
      <Link
        href={'/signin' as never}
        className="mt-1 flex min-h-[44px] items-center rounded-[var(--radius-md)] px-3 type-body-strong text-[var(--color-text-secondary)] no-underline transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="mt-2 px-3">
      <p className="type-caption clamp-1 m-0 text-[var(--color-text-primary)]">{user.name}</p>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        className="mt-1 cursor-pointer border-0 bg-transparent p-0 type-caption text-[var(--color-text-tertiary)] underline decoration-transparent underline-offset-4 transition-colors hover:text-[var(--color-text-secondary)] hover:decoration-[var(--color-border-strong)] disabled:cursor-not-allowed"
      >
        {signOut.isPending ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}

/**
 * The tab bar.
 *
 * Translucent over a blur rather than opaque, so the list underneath is
 * visibly *continuing* behind it instead of ending at a solid strip. It is the
 * one place in the app that blurs: everything else is flat, and a floating bar
 * over scrolling content is exactly the case the effect was invented for.
 */
function TabBar() {
  const pathname = usePathname();
  const t = useTranslator();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--color-border)] bg-[var(--color-surface-overlay)]/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      aria-label={t.t('nav.main')}
    >
      <ul className="m-0 flex list-none justify-around p-0">
        {/* Settings is appended rather than being part of `navItems`: it is
            not somewhere you go to find something to listen to, but it is the
            only route to account control while the sidebar is hidden. */}
        {[...navItems, settingsItem].map((item) => {
          const active = isActive(pathname, item.href);

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href as never}
                aria-current={active ? 'page' : undefined}
                className={[
                  // 64px tall: comfortably past the 44px minimum touch target,
                  // and the whole cell is tappable rather than just the label.
                  'flex h-16 flex-col items-center justify-center gap-1 no-underline',
                  'type-caption transition-colors',
                  active
                    ? 'text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-tertiary)]',
                ].join(' ')}
              >
                <NavIcon path={item.icon} filled={active} />
                {t.t(item.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Home matches only itself; every other tab also matches its subtree, so a
 * podcast page keeps Library highlighted rather than dropping the highlight
 * entirely and leaving the user unsure where they are.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
