'use client';

import { queryKeys, staleTime } from '@cue/api-client';
import { duration } from '@cue/motion';
import type { Episode, LibraryPodcast } from '@cue/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Artwork } from '@/components/media/artwork';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useTransition } from '@/lib/motion';

const PAGE_SIZE = 20;

/**
 * Add episodes to this playlist, from the shows already in the library.
 *
 * This is the control the playlist screen was missing entirely: a way to put
 * something *in* the list from the list's own page, rather than only from an
 * episode row somewhere else in the app. Apple Music and Spotify both open
 * this exact flow — browse, then add — from the playlist itself, and a
 * playlist that can only be filled from elsewhere is a dead end the moment
 * someone lands on an empty one.
 *
 * Scoped to followed shows rather than a free-text search across the whole
 * catalogue: there is no episode search index yet (only a podcast directory
 * search, which answers a different question), and "browse a show you already
 * follow" is a real, complete way to build a playlist without inventing one.
 */
export function AddEpisodesToPlaylist({
  playlistId,
  existingIds,
}: {
  playlistId: string;
  /** Episode ids already in this playlist, so a row can say so. */
  existingIds: Set<string>;
}) {
  const t = useTranslator();
  const settle = useTransition('standard');

  const [open, setOpen] = useState(false);
  const [podcast, setPodcast] = useState<LibraryPodcast | null>(null);

  return (
    <div>
      <Button
        variant="secondary"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {t.t('playlists.addEpisodes')}
      </Button>

      <AnimatePresence initial={false}>
        {open ? (
          <m.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ ...settle, opacity: { duration: duration.fast / 1000 } }}
            className="mt-3 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]"
          >
            <div className="max-h-[420px] overflow-y-auto p-2">
              {podcast ? (
                <EpisodePicker
                  playlistId={playlistId}
                  podcast={podcast}
                  existingIds={existingIds}
                  onBack={() => setPodcast(null)}
                />
              ) : (
                <ShowPicker onPick={setPodcast} />
              )}
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Step one: which of your shows. */
function ShowPicker({ onPick }: { onPick: (podcast: LibraryPodcast) => void }) {
  const t = useTranslator();

  const { data, isPending } = useQuery({
    queryKey: queryKeys.library.subscriptions(),
    queryFn: () => api.listSubscriptions({ limit: 100 }),
    staleTime: staleTime.podcast,
  });

  const shows = data?.items ?? [];

  if (isPending) {
    return (
      <p className="type-caption m-0 px-3 py-2 text-[var(--color-text-tertiary)]">
        {t.t('common.loading')}
      </p>
    );
  }

  if (shows.length === 0) {
    return (
      <p className="type-caption m-0 px-3 py-4 text-center text-[var(--color-text-tertiary)]">
        {t.t('playlists.followFirst')}
      </p>
    );
  }

  return (
    <ul className="m-0 list-none p-0">
      {shows.map((show) => (
        <li key={show.id}>
          <button
            type="button"
            onClick={() => onPick(show)}
            className="flex w-full min-h-14 cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] border-none bg-transparent px-2 text-start transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            <Artwork src={show.artworkUrl} alt={show.title} size={40} />
            <span className="type-body clamp-1 flex-1 text-[var(--color-text-primary)]">
              {show.title}
            </span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-[var(--color-text-tertiary)]"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Step two: which of this show's episodes. */
function EpisodePicker({
  playlistId,
  podcast,
  existingIds,
  onBack,
}: {
  playlistId: string;
  podcast: LibraryPodcast;
  existingIds: Set<string>;
  onBack: () => void;
}) {
  const t = useTranslator();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data, isPending } = useQuery({
    queryKey: [...queryKeys.podcast.episodes(podcast.id), 'page', page, PAGE_SIZE],
    queryFn: () => api.getEpisodePage(podcast.id, { page, limit: PAGE_SIZE }),
    staleTime: staleTime.episodes,
  });

  const add = useMutation({
    mutationFn: (episode: Episode) => api.addToPlaylist(playlistId, episode.id),
    onSettled: () => {
      // The full round trip rather than an optimistic splice: this component
      // does not hold the playlist's own entry shape (podcast title, accent
      // colour) for episodes outside the show being browsed, so there is
      // nothing honest to splice in early. The parent's `order` re-syncs the
      // moment this answers.
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.detail(playlistId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    },
  });

  const remove = useMutation({
    mutationFn: (episode: Episode) => api.removeFromPlaylist(playlistId, episode.id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.detail(playlistId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    },
  });

  const episodes = data?.items ?? [];

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="type-caption mb-2 flex min-h-9 cursor-pointer items-center gap-1 border-none bg-transparent px-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        {podcast.title}
      </button>

      {isPending ? (
        <p className="type-caption m-0 px-3 py-2 text-[var(--color-text-tertiary)]">
          {t.t('common.loading')}
        </p>
      ) : episodes.length === 0 ? (
        <p className="type-caption m-0 px-3 py-4 text-center text-[var(--color-text-tertiary)]">
          {t.t('podcast.noEpisodes')}
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {episodes.map((episode) => {
            const inIt = existingIds.has(episode.id);
            const busy =
              (add.isPending && add.variables?.id === episode.id) ||
              (remove.isPending && remove.variables?.id === episode.id);

            return (
              <li key={episode.id}>
                <div className="flex w-full min-h-14 items-center gap-3 rounded-[var(--radius-sm)] px-2 hover:bg-[var(--color-surface-hover)]">
                  <Artwork
                    src={episode.artworkUrl ?? podcast.artworkUrl}
                    alt={episode.title}
                    size={40}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="type-body clamp-1 m-0 text-[var(--color-text-primary)]">
                      {episode.title}
                    </p>
                    <p className="type-caption mt-0.5 mb-0 text-[var(--color-text-tertiary)]">
                      {t.episodeDate(episode.publishedAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={inIt ? 'ghost' : 'secondary'}
                    busy={busy}
                    onClick={() => (inIt ? remove.mutate(episode) : add.mutate(episode))}
                  >
                    {inIt ? t.t('playlists.added') : t.t('playlists.add')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data && data.pageCount > 1 ? (
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            {t.t('podcast.previousPage')}
          </Button>
          <span className="type-caption text-[var(--color-text-tertiary)]">
            {t.t('podcast.pageOf', { page, count: data.pageCount })}
          </span>
          <Button
            type="button"
            variant="ghost"
            disabled={page >= data.pageCount}
            onClick={() => setPage((current) => current + 1)}
          >
            {t.t('podcast.nextPage')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
