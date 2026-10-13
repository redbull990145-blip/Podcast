'use client';

import { queryKeys, staleTime } from '@cue/api-client';
import { groupLibrary } from '@cue/core';
import { useTranslator } from '@/components/i18n/locale-provider';
import { TINT_ATTR, tintVars } from '@cue/design';
import type { LibraryPodcast } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { memo, useMemo } from 'react';
import { Artwork } from '@/components/media/artwork';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useOnline } from '@/lib/connectivity';
import { useSession } from '@/lib/session';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * The library, organised by your relationship to each show rather than by the
 * catalogue's alphabet: what is waiting, what is still running, what has ended.
 *
 * Colour comes entirely from the artwork. Each row carries a tint derived from
 * its own cover, which is what makes a list of ten shows read as colourful
 * without the product inventing a single colour of its own.
 */
export function LibraryClient() {
  const t = useTranslator();
  const online = useOnline();
  const { isSignedIn, isLoading: sessionLoading } = useSession();

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.library.subscriptions(),
    queryFn: () => api.listSubscriptions({ limit: 100 }),
    enabled: isSignedIn,
    staleTime: staleTime.podcast,
  });

  const groups = useMemo(() => groupLibrary(data?.items ?? []), [data]);

  if (sessionLoading) return <Placeholder />;

  if (!isSignedIn) {
    return (
      <Empty
        heading={t.t('library.signedOut')}
        body={t.t('library.signedOutBody')}
        action={{ href: '/signin', label: t.t('common.signIn') }}
        secondary={{ href: '/search', label: t.t('library.browseAnyway') }}
      />
    );
  }

  // A failed request has two meanings and only one of them is a fault. With no
  // connection there is nothing wrong to report — the library is simply behind
  // a network that is not there, and saying so beats blaming the server.
  if (error) {
    return online ? (
      <Empty heading={t.t('library.failed')} body={t.t('common.offline')} />
    ) : (
      <Empty heading={t.t('offline.title')} body={t.t('offline.pageBody')} />
    );
  }

  if (isPending) return <Placeholder />;

  if (groups.length === 0) {
    return (
      <Empty
        heading={t.t('library.empty')}
        body={t.t('library.emptyBody')}
        action={{ href: '/search', label: t.t('library.findSomething') }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-12">
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`group-${group.id}`}>
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2
              id={`group-${group.id}`}
              className="type-title3 m-0 text-[var(--color-text-primary)]"
            >
              {group.title}
            </h2>
            <span className="type-caption shrink-0 text-[var(--color-text-tertiary)]">
              {group.caption}
            </span>
          </div>

          <ul className="m-0 list-none p-0">
            {group.items.map((item) => (
              /*
                Rows off screen are skipped for layout and paint.

                This screen fetches up to a hundred shows, which is past the
                point where mounting every row is free — each one decodes
                artwork and computes a tint. `content-visibility` buys most of
                what a windowed list would, without a windowed list: the whole
                document stays present, so find-in-page still finds a show the
                reader can't currently see, and the grouped sections keep their
                real heights instead of needing a measured estimate.

                `contain-intrinsic-size` is what keeps the scrollbar honest —
                without it, unrendered rows measure as zero and the page grows
                as you scroll into it.
              */
              <li
                key={item.id}
                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 72px' }}
              >
                <ShowRow show={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Memoised: up to a hundred of these render, and any shell-level state change
 * (session settling, connectivity flipping) would otherwise re-run every row's
 * tint resolution for identical output.
 */
const ShowRow = memo(function ShowRow({ show }: { show: LibraryPodcast }) {
  const t = useTranslator();
  /*
    Both fits of the show's colour, resolved by the stylesheet.

    This used to be `deriveTint(…, 'dark')`, with a comment claiming light mode
    "inherits the same hue through the CSS variables below" — it did not. The
    wash it produced is fitted to sit under a near-black ground, so hovering a
    row in the light theme dropped a dark bar behind text that is still
    `#17140F`: the show, its author and its date all disappeared under the
    cursor. `--tint-wash` now carries whichever fit matches the live theme.

    `--row-text` went with it. It was declared here and read nowhere — the
    badge below always used the value directly.
  */
  const tint = tintVars(show.accentColor);
  const hasNew = show.newEpisodeCount > 0;

  return (
    <Link
      href={`/podcast/${show.id}` as never}
      className="group relative flex items-center gap-4 rounded-[var(--radius-lg)] px-3 py-3 no-underline transition-transform duration-[var(--duration-instant)] ease-standard active:scale-[0.99] motion-reduce:active:scale-100"
      {...(tint ? { [TINT_ATTR]: '', style: tint as React.CSSProperties } : {})}
    >
      {/* The tint sits behind the row and only surfaces on hover. Painting it
          on every row at rest would turn a list into a stack of coloured bars;
          revealing it on approach makes the colour feel like a property of the
          show rather than of the UI. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[var(--radius-lg)] opacity-0 transition-opacity duration-[var(--duration-base)] ease-standard group-hover:opacity-100 group-active:opacity-100"
        style={{ background: tint ? 'var(--tint-wash)' : 'var(--color-surface-hover)' }}
      />

      <Artwork src={show.artworkUrl} alt={show.title} size={64} className="relative" />

      <div className="relative min-w-0 flex-1">
        <h3 className="type-body-strong clamp-1 m-0 text-[var(--color-text-primary)]">
          {show.title}
        </h3>
        {show.author ? (
          <p className="type-callout clamp-1 mt-0.5 mb-0 text-[var(--color-text-secondary)]">
            {show.author}
          </p>
        ) : null}
        <p className="type-caption mt-1.5 mb-0 text-[var(--color-text-tertiary)]">
          {show.lastPublishedAt
            ? t.t('library.latest', { date: t.episodeDate(show.lastPublishedAt) })
            : t.t('library.noEpisodes')}
        </p>
      </div>

      {hasNew ? (
        <span
          className="relative shrink-0 rounded-[var(--radius-full)] px-2.5 py-1 type-caption"
          style={{
            // The one place artwork colour is used at full strength: it marks
            // the single fact this screen exists to surface.
            //
            // Both halves come from the same fit, so this pair is legible in
            // either theme by construction — it is text on the tint's *own*
            // wash rather than on the page, which is why it was never part of
            // the bug the row above had.
            color: tint ? 'var(--tint-text)' : 'var(--color-accent-text)',
            backgroundColor: tint ? 'var(--tint-wash)' : 'var(--color-accent-muted)',
          }}
        >
          {/* Terse on purpose. "20 new episodes" squeezed a 375px row until the
              show's own title truncated to "Syntax -…", and the group's caption
              already says these are new since you subscribed. The count is the
              information; the noun was decoration. */}
          <span aria-hidden="true">{t.t('library.newCount', { count: show.newEpisodeCount })}</span>
          <span className="sr-only">
            {t.t('library.newEpisodes', { count: show.newEpisodeCount })}
          </span>
        </span>
      ) : null}
    </Link>
  );
});

function Placeholder() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-4 px-3 py-3">
          <div className="h-16 w-16 shrink-0 rounded-[var(--radius-md)] bg-[var(--color-skeleton)]" />
          <div className="min-w-0 flex-1">
            <div className="h-[15px] w-[42%] rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
            <div className="mt-2 h-[13px] w-[26%] rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({
  heading,
  body,
  action,
  secondary,
}: {
  heading: string;
  body: string;
  action?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  /*
    `plain`, not the dashed panel the playlists use.

    The Library's empty state is the *whole page*, not a container inside one —
    there is nothing around it for a box to be distinguished from, and drawing
    an edge would be the app putting a frame around an absence.
  */
  return (
    <EmptyState
      tone="plain"
      title={heading}
      body={body}
      action={
        action || secondary ? (
          <>
            {action ? (
              <Link href={action.href as never} className="no-underline">
                <Button>{action.label}</Button>
              </Link>
            ) : null}
            {secondary ? (
              <Link href={secondary.href as never} className="no-underline">
                <Button variant="ghost">{secondary.label}</Button>
              </Link>
            ) : null}
          </>
        ) : null
      }
    />
  );
}
