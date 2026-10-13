'use client';

import { queryKeys } from '@cue/api-client';
import { playableFromQueueEntry } from '@cue/core';
import { resolvePlaylistPalette } from '@cue/design';
import type { PlaylistEntry, PlaylistPodcastEntry } from '@cue/types';
import { PLAYLIST_TITLE_MAX } from '@cue/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { AddEpisodesToPlaylist } from '@/components/playlist/add-episodes-to-playlist';
import { AddShowsToPlaylist } from '@/components/playlist/add-shows-to-playlist';
import { PlaylistAppearance } from '@/components/playlist/playlist-appearance';
import { PlaylistBanner } from '@/components/playlist/playlist-banner';
import { Button } from '@/components/ui/button';
import { ChromeTint } from '@/components/shell/chrome-tint';
import { api } from '@/lib/api';
import { usePlayerActions } from '@/lib/player/store';
import { PageShell } from '@/components/ui/page-shell';
import { EmptyState } from '@/components/ui/empty-state';

/** Both carry the projection engine, so they arrive on demand — see each file. */
const PlaylistList = dynamic(() => import('./playlist-list'), {
  ssr: false,
  loading: () => <div className="min-h-40" aria-hidden="true" />,
});

const PlaylistShowList = dynamic(() => import('./playlist-show-list'), {
  ssr: false,
  loading: () => <div className="min-h-40" aria-hidden="true" />,
});

/**
 * One playlist.
 *
 * The order is content here, exactly as it is on the queue screen, so it is
 * edited by dragging rather than through a menu — and the same fractional keys
 * make that one write per drag instead of renumbering the list.
 *
 * Which list is dragged depends on `kind`, and only one of them is ever
 * mounted: a show playlist has no episodes and an episode playlist has no
 * shows, so rendering both and hiding one would mean shipping a projection
 * engine twice to draw nothing.
 */
export function PlaylistClient({ playlistId }: { playlistId: string }) {
  const t = useTranslator();
  const router = useRouter();
  const queryClient = useQueryClient();
  const actions = usePlayerActions();

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.playlists.detail(playlistId),
    queryFn: () => api.getPlaylist(playlistId),
  });

  const playlist = data?.playlist;

  /**
   * A local copy of the order, so a drag lands at 60fps.
   *
   * Reordering through the query cache would mean every frame of a drag waits
   * on a round trip. This holds the order while it is being edited and the
   * mutation catches up behind it; the server is still authoritative, and the
   * invalidation below re-syncs when it answers.
   */
  const [order, setOrder] = useState<PlaylistEntry[]>([]);
  const [showOrder, setShowOrder] = useState<PlaylistPodcastEntry[]>([]);
  const [customising, setCustomising] = useState(false);

  useEffect(() => {
    if (!playlist) return;
    setOrder(playlist.items);
    setShowOrder(playlist.podcasts);
  }, [playlist]);

  // What the "add" pickers use to say "already in here" — recomputed only when
  // the order they are drawn from actually changes, not on every keystroke
  // elsewhere on the page.
  const existingEpisodeIds = useMemo(
    () => new Set(order.map((item) => item.episode.id)),
    [order],
  );
  const existingPodcastIds = useMemo(
    () => new Set(showOrder.map((item) => item.podcast.id)),
    [showOrder],
  );

  const reorder = useMutation({
    mutationFn: (episodeIds: string[]) => api.reorderPlaylist(playlistId, episodeIds),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.detail(playlistId) });
    },
  });

  const reorderShows = useMutation({
    mutationFn: (podcastIds: string[]) => api.reorderPlaylistPodcasts(playlistId, podcastIds),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.detail(playlistId) });
    },
  });

  const remove = useMutation({
    mutationFn: (episodeId: string) => api.removeFromPlaylist(playlistId, episodeId),
    onMutate: (episodeId) => {
      // Optimistic: the row leaves under the finger that removed it rather than
      // after a round trip, which is what makes clearing out a playlist bearable.
      setOrder((current) => current.filter((item) => item.episode.id !== episodeId));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    },
  });

  const removeShow = useMutation({
    mutationFn: (podcastId: string) => api.removePodcastFromPlaylist(playlistId, podcastId),
    onMutate: (podcastId) => {
      setShowOrder((current) => current.filter((item) => item.podcast.id !== podcastId));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    },
  });

  // Stable identities for the drag lists below — see the call sites. `mutate`
  // is the stable half of a mutation object; the result object itself is not.
  const handleReorder = useCallback(
    (next: PlaylistEntry[]) => {
      setOrder(next);
      reorder.mutate(next.map((item) => item.episode.id));
    },
    [reorder.mutate],
  );

  const handleRemove = useCallback(
    (episodeId: string) => remove.mutate(episodeId),
    [remove.mutate],
  );

  const handleReorderShows = useCallback(
    (next: PlaylistPodcastEntry[]) => {
      setShowOrder(next);
      reorderShows.mutate(next.map((item) => item.podcast.id));
    },
    [reorderShows.mutate],
  );

  const handleRemoveShow = useCallback(
    (podcastId: string) => removeShow.mutate(podcastId),
    [removeShow.mutate],
  );

  const destroy = useMutation({
    mutationFn: () => api.deletePlaylist(playlistId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
      router.push('/playlists' as Route);
    },
  });

  if (error) {
    return (
      <PageShell>
        <Notice heading={t.t('playlists.notFound')} body={t.t('common.checkConnection')}>
          <Link href={'/playlists' as Route} className="no-underline">
            <Button variant="secondary">{t.t('playlists.title')}</Button>
          </Link>
        </Notice>
      </PageShell>
    );
  }

  if (isPending || !playlist) return null;

  const isShows = playlist.kind === 'podcast';
  const count = isShows ? showOrder.length : order.length;

  /**
   * Play the whole thing.
   *
   * The first episode starts and the rest queue behind it, which is what "play
   * all" means in every media app — replacing the queue outright would throw
   * away whatever someone had already lined up.
   *
   * Absent on show playlists. "Play all" over a shelf of podcasts would have to
   * invent an order across thousands of episodes, and any answer it picked
   * would be a guess about what someone wanted to hear.
   */
  const playAll = () => {
    const playables = order.map(playableFromQueueEntry);
    const [first, ...rest] = playables;
    if (!first) return;

    void actions.play(first);
    if (rest.length > 0) actions.enqueue(...rest);
  };

  /*
    The seed for the page's own colour, when one is set.

    Either gradient stop works: `tintedScheme` (behind `ChromeTint`) extracts
    only the *hue* from this value and refits lightness and chroma per role and
    per theme itself, so which stop is handed in cannot change the result.
  */
  const tintSeed = playlist.backgroundColor
    ? resolvePlaylistPalette(playlist.backgroundColor).to
    : null;

  return (
    /*
      The playlist's own re-theme, done the same way a podcast page's is.

      This used to be a hand-rolled div with negative margins clawing back to
      the page's own gutters and a `min-h-[100dvh]` guess — and it never
      actually reached the real edges of the window, because the gutters it
      was negating belong to an *inner* wrapper one level down, while the true
      page edge is `<main>`'s, further up the tree, outside anything this
      component can negatively-margin its way to. `ChromeTint` sidesteps the
      whole problem: it repaints `--color-*` on every element carrying
      `data-chrome-tint` — the sidebar, the tab bar, the player, and this page's
      own root — from one stylesheet rule, so "reaches every edge" is true by
      construction rather than by arithmetic against a padding value someone
      might change.

      `min-h-dvh` still matters here, for the same reason it matters on the
      podcast page one directory up: without it, a two-episode playlist paints
      a colour exactly as tall as two rows and stops in a hard line, which
      reads as broken rather than as a short list on a tinted page.
    */
    <div className="relative min-h-dvh bg-[var(--color-bg)]" data-chrome-tint="">
      <ChromeTint color={tintSeed} />

      <PageShell className="relative">
        <div className="flex flex-col gap-8">
          <PlaylistBanner banner={playlist.banner} title={playlist.title} height={200} />

          <header className="flex flex-col gap-4">
            <PlaylistTitle playlistId={playlistId} title={playlist.title} />

            <p className="type-callout m-0 text-[var(--color-text-tertiary)]">
              {isShows
                ? t.t('playlists.countShows', { count })
                : t.t('playlists.count', { count })}
            </p>

            {playlist.description ? (
              <p className="type-body m-0 max-w-[var(--measure-prose)] text-[var(--color-text-secondary)]">
                {playlist.description}
              </p>
            ) : null}

            {/*
              The control this screen was missing: a way to put something in
              the playlist from the playlist's own page. It goes first, before
              Play all, because filling an empty list is the more likely reason
              anyone is looking at the header — Play all is disabled until
              there is something to play, but adding is always the live option.
            */}
            <div className="flex flex-wrap items-center gap-3">
              {isShows ? (
                <AddShowsToPlaylist playlistId={playlistId} existingIds={existingPodcastIds} />
              ) : (
                <AddEpisodesToPlaylist playlistId={playlistId} existingIds={existingEpisodeIds} />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {isShows ? null : (
                <Button onClick={playAll} disabled={order.length === 0}>
                  {t.t('playlists.playAll')}
                </Button>
              )}

              <Button
                variant="secondary"
                onClick={() => setCustomising((current) => !current)}
                aria-expanded={customising}
              >
                {customising ? t.t('playlists.customiseDone') : t.t('playlists.customise')}
              </Button>

              <Button
                variant="ghost"
                busy={destroy.isPending}
                onClick={() => {
                  // A native confirm rather than a bespoke dialog: this is the
                  // one destructive action in the app, it is rare, and a real
                  // modal here would be a focus trap and a scroll lock for a
                  // question the platform already asks well.
                  if (
                    !window.confirm(t.t('playlists.deleteConfirm', { title: playlist.title }))
                  ) {
                    return;
                  }
                  destroy.mutate();
                }}
              >
                {t.t('playlists.delete')}
              </Button>
            </div>
          </header>

          {customising ? <PlaylistAppearance playlist={playlist} /> : null}

          {count === 0 ? (
            <Notice
              heading={isShows ? t.t('playlists.noShows') : t.t('playlists.noEpisodes')}
              body={isShows ? t.t('playlists.noShowsBody') : t.t('playlists.noEpisodesBody')}
            />
          ) : isShows ? (
            <PlaylistShowList
              order={showOrder}
              onReorder={handleReorderShows}
              onRemove={handleRemoveShow}
            />
          ) : (
            <PlaylistList
              order={order}
              // Stable identities: the list memoises its rows, and a fresh
              // closure per render would silently un-memoise every one of them
              // on every keystroke elsewhere in the component.
              onReorder={handleReorder}
              onRemove={handleRemove}
            />
          )}
        </div>
      </PageShell>
    </div>
  );
}

/**
 * The title, editable in place.
 *
 * Renaming is a small enough act that sending someone to a settings screen for
 * it is out of proportion — and the heading is where a person looks to change
 * a name.
 */
function PlaylistTitle({ playlistId, title }: { playlistId: string; title: string }) {
  const t = useTranslator();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  const rename = useMutation({
    mutationFn: (next: string) => api.updatePlaylist(playlistId, { title: next }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    },
  });

  if (!editing) {
    return (
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="type-display m-0 text-[var(--color-text-primary)]">{title}</h1>
        <button
          type="button"
          onClick={() => {
            setDraft(title);
            setEditing(true);
          }}
          className="type-caption cursor-pointer border-none bg-transparent p-0 text-[var(--color-text-tertiary)] underline decoration-transparent underline-offset-4 transition-colors hover:text-[var(--color-text-secondary)] hover:decoration-[var(--color-border-strong)]"
        >
          {t.t('playlists.rename')}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const next = draft.trim();
        if (next.length === 0 || next === title) {
          setEditing(false);
          return;
        }
        rename.mutate(next);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={PLAYLIST_TITLE_MAX}
        aria-label={t.t('playlists.name')}
        autoFocus
        className="type-title2 min-h-11 min-w-[200px] flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[var(--color-text-primary)]"
      />
      <Button type="submit" busy={rename.isPending}>
        {t.t('playlists.save')}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
        {t.t('common.cancel')}
      </Button>
    </form>
  );
}

function Notice({
  heading,
  body,
  children,
}: {
  heading: string;
  body: string;
  children?: React.ReactNode;
}) {
  return <EmptyState title={heading} body={body} action={children} />;
}
