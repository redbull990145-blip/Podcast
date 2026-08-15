'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession, useSignOut } from '@/lib/session';
import { Player } from '@/components/player/player';
import { OfflineBanner } from '@/components/pwa/offline-banner';
import { ServiceWorker } from '@/components/pwa/service-worker';
import { hydrateQueue, setSyncState } from '@/lib/player/store';
import { NavIcon } from './nav-icon';
import { useTranslator } from '@/components/i18n/locale-provider';
import { navItems, settingsItem } from './nav-items';

/**
 * The app shell.
 *
 * Persistent across navigation: the sidebar and tab bar never unmount, so
 * moving between screens replaces only the content area. That is what makes
 * navigation read as instant — there is no chrome to rebuild, and later the
 * player will live here too and keep playing straight through a route change.
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

      {/* Left gutter on desktop clears the sidebar; bottom padding on mobile
          clears the tab bar so the last row is never trapped under it. The
          extra 24px is breathing room — content ending exactly at the bar's
          edge reads as clipped even when it is technically clear of it. */}
      <main className="pb-[calc(160px+env(safe-area-inset-bottom))] md:pb-[88px] md:pl-[240px]">
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

  return (
    <aside
      className="fixed inset-y-0 start-0 z-20 hidden w-[240px] flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] px-3 pt-6 pb-8 md:flex"
      aria-label={t.t('nav.main')}
    >
      <Link
        href={'/' as never}
        className="mb-8 px-3 type-title2 text-[var(--color-text-primary)] no-underline"
      >
        Cue
      </Link>

      <nav>
        <ul className="flex list-none flex-col gap-1 p-0">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href as never}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 no-underline',
                    'type-body-strong transition-colors',
                    active
                      ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-text)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
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

      {/* A hairline separates the account row from navigation: it is a
          different kind of control, and pinning it to the floor without one
          reads as an item that fell off the list. */}
      <div className="mt-auto border-t border-[var(--color-border)] pt-4">
        <Link
          href={settingsItem.href as never}
          aria-current={isActive(pathname, settingsItem.href) ? 'page' : undefined}
          className={[
            'mb-1 flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 no-underline',
            'type-body-strong transition-colors',
            isActive(pathname, settingsItem.href)
              ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-text)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
          ].join(' ')}
        >
          <NavIcon path={settingsItem.icon} filled={false} />
          {t.t(settingsItem.label)}
        </Link>

        <AccountStrip />
      </div>
    </aside>
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
        className="flex min-h-[44px] items-center rounded-[var(--radius-md)] px-3 type-body-strong text-[var(--color-text-secondary)] no-underline transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="px-3">
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

function TabBar() {
  const pathname = usePathname();
  const t = useTranslator();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--color-border)] bg-[var(--color-surface)] pb-[env(safe-area-inset-bottom)] md:hidden"
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
                    ? 'text-[var(--color-accent-text)]'
                    : 'text-[var(--color-text-secondary)]',
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
