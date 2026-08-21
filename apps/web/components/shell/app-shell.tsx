'use client';

import { queryKeys, staleTime } from '@cue/api-client';
import type { LibraryPodcast } from '@cue/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession, useSignOut } from '@/lib/session';
import { Artwork } from '@/components/media/artwork';
import { Player } from '@/components/player/player';
import { UpNext } from '@/components/player/up-next';
import { OfflineBanner } from '@/components/pwa/offline-banner';
import { ServiceWorker } from '@/components/pwa/service-worker';
import { api } from '@/lib/api';
import {
  hydrateQueue,
  NOW_PLAYING_SYNCED,
  setSyncState,
  usePlayerState,
} from '@/lib/player/store';
import { setRailCollapsed, useRailCollapsed } from '@/lib/rail';
import { NavIcon } from './nav-icon';
import { NowPlayingTint } from './now-playing-tint';
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
  useNowPlayingSync();

  return (
    <div className="min-h-dvh">
      {/* Registered from the shell rather than the root layout: there is
          nothing worth caching on the auth pages, and a worker claiming the
          page mid-sign-in is a complication with no upside. */}
      <ServiceWorker />
      <OfflineBanner />

      {/* Repaints the window in the playing episode's colour, when the listener
          has asked for that. Renders nothing on its own. */}
      <NowPlayingTint />

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
      {/*
        Backgrounded and tintable, not transparent.

        The bottom padding here is a gutter reserved for the mini-player bar —
        104px on desktop, more on mobile for the safe area — and it sits *below*
        whatever the page renders. A tinted page like a podcast's has its own
        coloured `min-h-dvh` div, which ends where its content ends; this
        padding is outside that div, so without a background of its own here it
        showed `<body>`'s plain ground as a flat black band under a navy page —
        the seam most visible on exactly the pages that went to the trouble of
        having a colour.

        `data-chrome-tint` picks this up the same way the rail and the tab bar
        do — see `ChromeTint`. On an untinted page nothing overrides the
        variable and this is just the ordinary background, same as before.
      */}
      <main
        data-chrome-tint=""
        className="bg-[var(--color-bg)] pb-[calc(160px+env(safe-area-inset-bottom))] md:pb-[104px] md:ps-[var(--measure-sidebar)]"
      >
        {children}
      </main>

      {/* Outside <main>, so a route change never unmounts it and playback
          continues straight through navigation. */}
      <Player />

      {/* Announces the queue advancing, in the last seconds of an episode.
          Beside the player rather than inside it: the mini bar's layout is one
          interpolated motion value from cover to full sheet, and a card that
          appears and leaves on its own schedule has no place in that. */}
      <UpNext />

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

/**
 * Refetch the library views once the server knows what is playing.
 *
 * Home's resume hero, recently played and the listening figures are all served
 * from progress the player writes on a debounce, so pressing play left them
 * describing the *previous* episode — the hero naming one thing directly above
 * a player bar naming another. The store closes that by writing immediately and
 * announcing when the write lands; this is the half that acts on it.
 *
 * In the shell rather than in `ContinueListening` because three sections go
 * stale together, and only one of them is on the screen where it is most
 * obvious. Invalidating the whole `library` key rather than naming each query
 * means a section added later is right by default instead of being the next
 * thing someone notices is lying.
 */
function useNowPlayingSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const refresh = () => {
      // `invalidateQueries`, not `refetchQueries`: a section nobody is looking
      // at is marked stale and refetches when it next mounts, so switching
      // episodes on the queue screen does not fire requests for Home.
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    };

    window.addEventListener(NOW_PLAYING_SYNCED, refresh);
    return () => window.removeEventListener(NOW_PLAYING_SYNCED, refresh);
  }, [queryClient]);
}

function SidebarNav() {
  const pathname = usePathname();
  const t = useTranslator();
  /* How many episodes are waiting, shown against Queue. It is the one number
     in the app that changes because of something you did on another screen,
     which is exactly the kind of fact a persistent rail is for. */
  const queued = usePlayerState().queue.length;
  const collapsed = useRailCollapsed();

  return (
    <aside
      /*
        `w-[var(--measure-sidebar)]`, and the variable is what moves.

        Collapsing is one property write on `<html>`, so the rail, the content
        gutter that clears it and the player bar that starts where it ends all
        change together — none of them has to know the rail can fold. Writing a
        `w-[72px]` class here instead would have folded the rail and left the
        page with a 260px hole beside it.

        The rail carries `--color-surface` rather than sitting on the page
        ground. On paper that is a *recess*, so navigation reads as a panel the
        content sits beside rather than as text floating at the edge of the
        window — which is most of what made the light theme feel like an
        unstyled document.
      */
      className="fixed inset-y-0 start-0 z-20 hidden w-[var(--measure-sidebar)] flex-col border-e border-[var(--color-border)] bg-[var(--color-surface)] pt-6 pb-8 md:flex"
      // Marked so a page with a ground of its own can repaint the rail to
      // match — see `ChromeTint`. Nothing here changes when it does; the rail
      // paints entirely from `var(--color-…)` and simply gets different values.
      data-chrome-tint=""
      style={{ paddingInline: collapsed ? 16 : 18 }}
      aria-label={t.t('nav.main')}
    >
      <div
        className={[
          'mb-6 flex items-center',
          collapsed ? 'flex-col gap-3' : 'justify-between gap-2 ps-3',
        ].join(' ')}
      >
        {/* Collapsed, the wordmark becomes its initial rather than
            disappearing. A rail with no identity at the top reads as a toolbar
            that lost its window. */}
        <Link
          href={'/' as never}
          className="type-title3 text-[var(--color-text-primary)] no-underline"
          aria-label="Cue"
        >
          {collapsed ? 'C' : 'Cue'}
        </Link>

        <RailToggle collapsed={collapsed} />
      </div>

      <nav>
        <ul className="flex list-none flex-col gap-0.5 p-0">
          {navItems.map((item) => (
            <li key={item.href}>
              <RailLink
                item={item}
                active={isActive(pathname, item.href)}
                collapsed={collapsed}
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
      <SidebarShows collapsed={collapsed} />

      {/* A hairline separates the account row from navigation: it is a
          different kind of control, and pinning it to the floor without one
          reads as an item that fell off the list. */}
      <div className="mt-auto border-t border-[var(--color-border)] pt-4">
        <RailLink
          item={settingsItem}
          active={isActive(pathname, settingsItem.href)}
          collapsed={collapsed}
        />
        <AccountStrip collapsed={collapsed} />
      </div>
    </aside>
  );
}

/**
 * Fold the rail down to its icons.
 *
 * The rail is 260px of every desktop window, permanently, and most of that is
 * the "Your shows" list — which is the reason it is 260 rather than 240, and
 * the reason somebody reading a transcript on a 1280px laptop wants it gone.
 * Folding rather than hiding: the four destinations stay reachable, so this
 * costs the labels and nothing else.
 *
 * The chevron points the way the rail will move, not at the state it is in.
 * A control drawn as "«" while collapsed is describing itself; drawn as "»" it
 * is describing what pressing it does, which is the only thing anybody needs
 * from it.
 */
function RailToggle({ collapsed }: { collapsed: boolean }) {
  const t = useTranslator();
  const label = collapsed ? t.t('nav.expandRail') : t.t('nav.collapseRail');

  return (
    <button
      type="button"
      onClick={() => setRailCollapsed(!collapsed)}
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-md)] border-0 bg-transparent p-0 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        // Mirrored under RTL along with everything else, and mirrored *again*
        // when collapsed — the chevron means "toward the window edge", and
        // which way that is depends on both.
        style={{ transform: collapsed ? 'scaleX(-1)' : undefined }}
      >
        {/* A panel with its edge marked, and a chevron leaving through it. */}
        <path d="M4 5.5h16v13H4z" />
        <path d="M10 5.5v13" />
        <path d="M16.5 9.5 14 12l2.5 2.5" />
      </svg>
    </button>
  );
}

/**
 * One destination in the rail.
 *
 * The current page used to be marked in the accent and nothing else, on the
 * reasoning that a filled block makes the chrome the highest-contrast shape on
 * the screen. That reasoning was sound and the result was not: hue alone is a
 * weak signal at 15px, the accent is also spent on eyebrows and "new episode"
 * dots elsewhere, and the rail's inactive rows sit at full text colour — so
 * the only difference between "where I am" and "where I could go" was a slight
 * warmth on one word. People could not find themselves in it.
 *
 * So the active row now gets a ground as well as a colour. Two signals rather
 * than one, which is also what makes it survive being looked at quickly, in
 * bright light, or by someone who does not separate those two hues.
 *
 * The fill is `accent-muted` rather than the neutral hover wash. Both work as a
 * *ground*; only one of them is a colour. In the light theme especially, a
 * grey-on-cream rail was the largest permanently visible surface in the app and
 * had no hue anywhere in it, so the whole product read as an unstyled document
 * — the accent wash is a low-alpha ember that ties the rail to the one colour
 * this design actually has. It stays quiet enough that the row still reads as
 * *held* rather than as a button demanding attention, and it never
 * out-contrasts artwork.
 */
function RailLink({
  item,
  active,
  collapsed,
  badge,
}: {
  item: (typeof navItems)[number];
  active: boolean;
  collapsed: boolean;
  /** A count worth seeing from every screen. Absent when zero. */
  badge?: number | undefined;
}) {
  const t = useTranslator();
  const label = t.t(item.label);

  return (
    <Link
      href={item.href as never}
      aria-current={active ? 'page' : undefined}
      // The tooltip only exists while the words do not. Given unconditionally
      // it would sit a duplicate of the visible label under the cursor on every
      // row of an expanded rail.
      title={collapsed ? label : undefined}
      className={[
        'flex items-center rounded-[var(--radius-md)] py-2 no-underline transition-colors',
        collapsed ? 'justify-center px-0' : 'gap-3 px-3',
        active
          ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-text)]'
          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]',
      ].join(' ')}
    >
      {/* The badge follows the icon when there is no room beside it. A count
          pinned to the end of a 72px row lands on top of the glyph. */}
      <span className="relative flex shrink-0">
        <NavIcon path={item.icon} filled={active} size={16} />

        {collapsed && badge ? (
          <span
            aria-hidden="true"
            className="absolute -end-1.5 -top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]"
          />
        ) : null}
      </span>

      {collapsed ? (
        // Kept for screen readers, which have no cursor to hover with and would
        // otherwise be handed a rail of four unlabelled links.
        <span className="sr-only">{label}</span>
      ) : (
        <span className="type-body-strong">{label}</span>
      )}

      {!collapsed && badge ? (
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
function SidebarShows({ collapsed }: { collapsed: boolean }) {
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
      {/* The heading goes when the labels do. "Your shows" over a column of
          covers is a caption wider than the thing it captions, and the covers
          are perfectly legible as a list of shows without being told. A rule
          keeps the separation the heading was providing. */}
      {collapsed ? (
        <span aria-hidden="true" className="mb-2 border-t border-[var(--color-border)]" />
      ) : (
        <p className="type-overline m-0 mb-1.5 px-3 text-[var(--color-text-tertiary)]">
          {t.t('nav.yourShows')}
        </p>
      )}

      <ul
        aria-label={collapsed ? t.t('nav.yourShows') : undefined}
        className="m-0 flex list-none flex-col overflow-y-auto p-0"
      >
        {shows.map((show) => (
          <li key={show.id}>
            <ShowLink show={show} collapsed={collapsed} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShowLink({ show, collapsed }: { show: LibraryPodcast; collapsed: boolean }) {
  const t = useTranslator();
  const unread = show.newEpisodeCount > 0;

  return (
    <Link
      href={`/podcast/${show.id}` as never}
      title={collapsed ? show.title : undefined}
      className={[
        'flex items-center rounded-[var(--radius-sm)] py-1.5 no-underline transition-colors',
        'hover:bg-[var(--color-surface-hover)]',
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-3',
      ].join(' ')}
    >
      {/* The cover grows when it becomes the only thing identifying the show.
          At 22px in a 72px rail it reads as a stray dot. */}
      <span className="relative flex shrink-0">
        <Artwork src={show.artworkUrl} alt="" size={collapsed ? 30 : 22} />

        {collapsed && unread ? (
          <span
            className="absolute -end-1 -top-1 h-2 w-2 rounded-full bg-[var(--color-accent)] ring-2 ring-[var(--color-surface)]"
            title={t.t('library.newEpisodes', { count: show.newEpisodeCount })}
          />
        ) : null}
      </span>

      {collapsed ? (
        <span className="sr-only">{show.title}</span>
      ) : (
        <span className="type-caption clamp-1 min-w-0 flex-1 text-[var(--color-text-secondary)]">
          {show.title}
        </span>
      )}

      {/* A dot, not a count. The number is on the Library row where there is
          room to read it; here it only has to answer "is there anything?", and
          a two-digit badge at this size is a smudge. */}
      {!collapsed && unread ? (
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
function AccountStrip({ collapsed }: { collapsed: boolean }) {
  const t = useTranslator();
  const { user, isLoading } = useSession();
  const signOut = useSignOut();

  // Reserve the row's height while the session resolves; a control that pops
  // in afterwards shifts the sidebar under the cursor.
  if (isLoading) return <div aria-hidden="true" className="h-[44px]" />;

  if (!user) {
    return (
      <Link
        href={'/signin' as never}
        title={collapsed ? t.t('common.signIn') : undefined}
        className={[
          'mt-1 flex min-h-[44px] items-center rounded-[var(--radius-md)] no-underline transition-colors',
          'type-body-strong text-[var(--color-text-secondary)]',
          'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
          collapsed ? 'justify-center px-0' : 'px-3',
        ].join(' ')}
      >
        {collapsed ? (
          <>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="8.5" r="3.5" />
              <path d="M5 20a7 7 0 0 1 14 0" />
            </svg>
            <span className="sr-only">{t.t('common.signIn')}</span>
          </>
        ) : (
          t.t('common.signIn')
        )}
      </Link>
    );
  }

  /*
    Collapsed, the account becomes its initial and the sign-out control goes.

    Not folded into a menu behind the initial: signing out is a rare,
    irreversible-feeling action, and putting it behind a disclosure in a 72px
    rail is how it gets pressed by accident. Settings is one row above and has
    the same control with room to read it, so nothing is lost but the shortcut.
  */
  if (collapsed) {
    return (
      <Link
        href={'/settings' as never}
        title={user.name}
        className="mt-2 flex justify-center no-underline"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent-muted)] type-caption text-[var(--color-accent-text)]"
        >
          {initialOf(user.name)}
        </span>
        <span className="sr-only">{user.name}</span>
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
        {signOut.isPending ? t.t('settings.signingOut') : t.t('common.signOut')}
      </button>
    </div>
  );
}

/**
 * The first character of a name, as the reader's locale writes it.
 *
 * `[...name]` rather than `name[0]`, because a string index returns a UTF-16
 * code unit — which splits an emoji or an astral-plane character in half and
 * renders the replacement glyph. Uppercasing is left to `toLocaleUpperCase`,
 * which knows that Turkish "i" goes to "İ".
 */
function initialOf(name: string): string {
  return ([...name.trim()][0] ?? '?').toLocaleUpperCase();
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
      data-chrome-tint=""
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
                    : 'text-[var(--color-text-tertiary)]',
                ].join(' ')}
              >
                {/*
                  The ground goes behind the icon, not behind the whole cell.

                  A filled 64px block in a five-across bar is a button, and five
                  of them make the tab bar the loudest object on the screen. A
                  pill around the glyph is the same two signals the rail uses —
                  colour *and* a ground — at a size that marks a position
                  instead of demanding one.
                */}
                <span
                  className={[
                    'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                    active ? 'bg-[var(--color-accent-muted)]' : 'bg-transparent',
                  ].join(' ')}
                >
                  <NavIcon path={item.icon} filled={active} />
                </span>
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
