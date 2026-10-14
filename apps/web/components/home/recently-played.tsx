'use client';

import { queryKeys } from '@cue/api-client';
import { playableFromQueueEntry } from '@cue/core';
import type { HistoryEntry } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Artwork } from '@/components/media/artwork';
import { SectionHeader } from '@/components/ui/section-header';
import { api } from '@/lib/api';
import { usePlayerActions } from '@/lib/player/store';
import { useSession } from '@/lib/session';

/** Six: three rows in each of two columns, which is one clean block at any width. */
const SHOWN = 6;

/**
 * Recently played.
 *
 * The counterpart to Continue listening, and deliberately a much quieter one.
 * Continue is about *finishing* — it gets a hero, because an episode you are
 * half way through is the single most likely thing you want. This is about
 * *finding again*: the show you heard on Tuesday and now want to send someone,
 * the episode you finished and want to replay a bit of. That is a lookup, so
 * it is a list, at list weight, with the smallest artwork on the page.
 *
 * Two columns rather than one. Six rows in a single column below Home's other
 * sections is a long scroll for a section nobody came for; two columns of three
 * put the whole thing in one glance and let the page end.
 *
 * Absent when signed out or empty, rather than showing an empty frame — there
 * is no such thing as history without an account, and a heading over nothing is
 * chrome advertising a feature the reader has not reached.
 */
export function RecentlyPlayed() {
  const t = useTranslator();
  const { isSignedIn } = useSession();

  const { data } = useQuery({
    queryKey: queryKeys.library.history(),
    queryFn: () => api.getHistory(SHOWN),
    enabled: isSignedIn,
    // Moves the moment anything is played, and this is the screen someone
    // returns to straight after listening — a stale list here is visibly wrong
    // in a way a stale catalogue is not.
    staleTime: 60_000,
    retry: false,
  });

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="recent-heading"
      // A rule above rather than more space. By this point Home has run
      // through three sections of decreasing importance, and the border is
      // what says the page has changed register from recommending to
      // recording.
      className="mb-14 border-t border-[var(--color-border)] pt-9"
    >
      {/*
        No "All history" link, deliberately.

        The design has one, and there is nowhere for it to go: Library groups
        the shows you follow and has no history view, so the link would either
        land somewhere unrelated or need a route inventing for it. Six rows is
        also very nearly all the history most listeners have, so the affordance
        would mostly be a promise of more that does not exist. Worth building —
        just not by pointing at the wrong page in the meantime.
      */}
      <SectionHeader id="recent-heading" label={t.t('home.recentlyPlayed')} />

      <ul className="m-0 grid list-none grid-cols-1 gap-x-12 p-0 lg:grid-cols-2">
        {items.map((entry) => (
          <li key={entry.episode.id}>
            <HistoryRow entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One thing you listened to.
 *
 * A row, not a button containing a button — nesting one inside the other is
 * invalid HTML and the inner click would fire both. So the title is the link
 * and the play control sits beside it, which is also the honest division:
 * opening the episode and resuming it are different intentions, and this
 * section serves the first at least as often as the second.
 */
function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const t = useTranslator();
  const { play } = usePlayerActions();

  /*
    What the second line says depends on how it ended.

    "Finished" is the useful fact for a completed episode — it is why this row
    is not in Continue listening, and without it a finished episode and an
    abandoned one look identical. For everything else the date is what helps
    someone find it again, which is the job of this whole section.
  */
  const status = entry.completed
    ? t.t('home.finished')
    : t.episodeDate(entry.updatedAt);

  const meta = [entry.podcastTitle, status].filter(Boolean).join(' · ');

  return (
    <div className="flex items-center gap-3.5 border-b border-[var(--color-border)] py-3">
      {/* A flex container's underline never reaches its items, so the
          hover affordance lives on the title itself rather than on the
          link that wraps the row. */}
      <Link
        href={`/episode/${entry.episode.id}` as Route}
        className="group flex min-w-0 flex-1 items-center gap-3.5 no-underline"
      >
        <Artwork
          src={entry.episode.artworkUrl ?? entry.podcastArtworkUrl}
          alt=""
          size={46}
          // Played-out artwork, dimmed. The design's own signal that these are
          // behind you rather than ahead of you, and it costs no words.
          className={entry.completed ? 'opacity-70' : undefined}
        />

        <span className="min-w-0 flex-1">
          <span className="type-body-strong clamp-1 block text-[var(--color-text-primary)] underline decoration-transparent underline-offset-4 transition-colors group-hover:decoration-current">
            {entry.episode.title}
          </span>
          <span className="type-caption clamp-1 mt-0.5 block text-[var(--color-text-tertiary)]">
            {meta}
          </span>
        </span>
      </Link>

      {/* Outlined rather than filled. Every filled pill on Home is something
          the page is recommending you do; replaying something you already
          heard is available, not advised. */}
      <button
        type="button"
        onClick={() => void play(playableFromQueueEntry(entry), entry)}
        aria-label={t.t('home.resume', { title: entry.episode.title })}
        className="cue-button flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-transparent text-[var(--color-text-primary)] transition-[transform,background-color] duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] active:scale-[0.97] motion-reduce:active:scale-100"
      >
        <svg width="9" height="10" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
          <path d="M0 0 10 6 0 12Z" />
        </svg>
      </button>
    </div>
  );
}
