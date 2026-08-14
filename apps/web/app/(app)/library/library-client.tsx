'use client';

import { queryKeys, staleTime } from '@cue/api-client';
import { groupLibrary } from '@cue/core';
import { useTranslator } from '@/components/i18n/locale-provider';
import { deriveTint } from '@cue/design';
import type { LibraryPodcast } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo } from 'react';
import { Artwork } from '@/components/media/artwork';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

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
        body="Follow a show and it turns up on this screen — with whatever landed since you last listened."
        action={{ href: '/signin', label: 'Sign in' }}
        secondary={{ href: '/search', label: 'Browse without an account' }}
      />
    );
  }

  if (error) {
    return (
      <Empty
        heading={t.t('library.failed')}
        body={t.t('common.offline')}
      />
    );
  }

  if (isPending) return <Placeholder />;

  if (groups.length === 0) {
    return (
      <Empty
        heading={t.t('library.empty')}
        body="Find a show worth coming back to. Everything you follow collects here, newest first."
        action={{ href: '/search', label: 'Find something' }}
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
              <li key={item.id}>
                <ShowRow show={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ShowRow({ show }: { show: LibraryPodcast }) {
  const t = useTranslator();
  // Dark-first: the server has no way to know the user's theme before paint,
  // and reading it at render would cause a flash. Light mode inherits the same
  // hue through the CSS variables below.
  const tint = show.accentColor ? deriveTint(show.accentColor, 'dark') : null;
  const hasNew = show.newEpisodeCount > 0;

  return (
    <Link
      href={`/podcast/${show.id}` as never}
      className="group relative flex items-center gap-4 rounded-[var(--radius-lg)] px-3 py-3 no-underline"
      style={
        tint
          ? ({ '--row-wash': tint.wash, '--row-text': tint.text } as React.CSSProperties)
          : undefined
      }
    >
      {/* The tint sits behind the row and only surfaces on hover. Painting it
          on every row at rest would turn a list into a stack of coloured bars;
          revealing it on approach makes the colour feel like a property of the
          show rather than of the UI. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[var(--radius-lg)] opacity-0 transition-opacity duration-[var(--duration-base)] ease-standard group-hover:opacity-100"
        style={{ background: tint ? 'var(--row-wash)' : 'var(--color-surface-hover)' }}
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
            : 'No episodes yet'}
        </p>
      </div>

      {hasNew ? (
        <span
          className="relative shrink-0 rounded-[var(--radius-full)] px-2.5 py-1 type-caption"
          style={{
            // The one place artwork colour is used at full strength: it marks
            // the single fact this screen exists to surface.
            color: tint?.text ?? 'var(--color-accent-text)',
            backgroundColor: tint ? 'var(--row-wash)' : 'var(--color-accent-muted)',
          }}
        >
          {/* Terse on purpose. "20 new episodes" squeezed a 375px row until the
              show's own title truncated to "Syntax -…", and the group's caption
              already says these are new since you subscribed. The count is the
              information; the noun was decoration. */}
          <span aria-hidden="true">{show.newEpisodeCount} new</span>
          <span className="sr-only">
            {t.t('library.newEpisodes', { count: show.newEpisodeCount })}
          </span>
        </span>
      ) : null}
    </Link>
  );
}

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
  return (
    <div className="py-10">
      <h2 className="type-title2 m-0 max-w-[20ch] text-[var(--color-text-primary)]">{heading}</h2>
      <p className="type-body mt-3 mb-0 max-w-[46ch] text-[var(--color-text-secondary)]">{body}</p>

      {action || secondary ? (
        <div className="mt-7 flex flex-wrap items-center gap-3">
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
        </div>
      ) : null}
    </div>
  );
}
