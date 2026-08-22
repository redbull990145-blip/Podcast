'use client';

import { queryKeys, staleTime } from '@cue/api-client';
import { duration } from '@cue/motion';
import type { LibraryPodcast } from '@cue/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Artwork } from '@/components/media/artwork';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useTransition } from '@/lib/motion';

/**
 * Add shows to this playlist, from the shows already in the library.
 *
 * One level rather than two: unlike episodes, there is nothing to drill into —
 * a show playlist holds whole shows, and the library's own followed-shows list
 * is already exactly the set worth offering. Scoped to that list for the same
 * reason `AddEpisodesToPlaylist` is: there is no catalogue-wide search that
 * returns shows with an internal id ready to save, only the directory search
 * used for *finding and following* a show in the first place.
 */
export function AddShowsToPlaylist({
  playlistId,
  existingIds,
}: {
  playlistId: string;
  /** Podcast ids already in this playlist. */
  existingIds: Set<string>;
}) {
  const t = useTranslator();
  const settle = useTransition('standard');
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: queryKeys.library.subscriptions(),
    queryFn: () => api.listSubscriptions({ limit: 100 }),
    staleTime: staleTime.podcast,
    enabled: open,
  });

  const add = useMutation({
    mutationFn: (podcast: LibraryPodcast) => api.addPodcastToPlaylist(playlistId, podcast.id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.detail(playlistId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    },
  });

  const remove = useMutation({
    mutationFn: (podcast: LibraryPodcast) => api.removePodcastFromPlaylist(playlistId, podcast.id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.detail(playlistId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    },
  });

  const shows = data?.items ?? [];

  return (
    <div>
      <Button
        variant="secondary"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {t.t('playlists.addShows')}
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
              {isPending ? (
                <p className="type-caption m-0 px-3 py-2 text-[var(--color-text-tertiary)]">
                  {t.t('common.loading')}
                </p>
              ) : shows.length === 0 ? (
                <p className="type-caption m-0 px-3 py-4 text-center text-[var(--color-text-tertiary)]">
                  {t.t('playlists.followFirst')}
                </p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {shows.map((show) => {
                    const inIt = existingIds.has(show.id);
                    const busy =
                      (add.isPending && add.variables?.id === show.id) ||
                      (remove.isPending && remove.variables?.id === show.id);

                    return (
                      <li key={show.id}>
                        <div className="flex w-full min-h-14 items-center gap-3 rounded-[var(--radius-sm)] px-2 hover:bg-[var(--color-surface-hover)]">
                          <Artwork src={show.artworkUrl} alt={show.title} size={40} />
                          <span className="type-body clamp-1 flex-1 text-[var(--color-text-primary)]">
                            {show.title}
                          </span>
                          <Button
                            type="button"
                            variant={inIt ? 'ghost' : 'secondary'}
                            busy={busy}
                            onClick={() => (inIt ? remove.mutate(show) : add.mutate(show))}
                          >
                            {inIt ? t.t('playlists.added') : t.t('playlists.add')}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
