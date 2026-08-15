'use client';

import { queryKeys } from '@cue/api-client';
import { playableFromQueueEntry } from '@cue/core';
import { deriveTint } from '@cue/design';
import { duration } from '@cue/motion';
import type { PlaylistEntry } from '@cue/types';
import { PLAYLIST_TITLE_MAX } from '@cue/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, Reorder, useDragControls } from 'motion/react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Artwork } from '@/components/media/artwork';
import { CoverStack } from '@/components/playlist/cover-stack';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useTransition } from '@/lib/motion';
import { usePlayerActions } from '@/lib/player/store';

/**
 * One playlist.
 *
 * The order is content here, exactly as it is on the queue screen, so it is
 * edited by dragging rather than through a menu — and the same fractional keys
 * make that one write per drag instead of renumbering the list.
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

  useEffect(() => {
    if (playlist) setOrder(playlist.items);
  }, [playlist]);

  const reorder = useMutation({
    mutationFn: (episodeIds: string[]) => api.reorderPlaylist(playlistId, episodeIds),
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

  const destroy = useMutation({
    mutationFn: () => api.deletePlaylist(playlistId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
      router.push('/playlists' as Route);
    },
  });

  if (error) {
    return (
      <Notice heading={t.t('playlists.notFound')} body={t.t('common.checkConnection')}>
        <Link href={'/playlists' as Route} className="no-underline">
          <Button variant="secondary">{t.t('playlists.title')}</Button>
        </Link>
      </Notice>
    );
  }

  if (isPending || !playlist) return null;

  /**
   * Play the whole thing.
   *
   * The first episode starts and the rest queue behind it, which is what "play
   * all" means in every media app — replacing the queue outright would throw
   * away whatever someone had already lined up.
   */
  const playAll = () => {
    const playables = order.map(playableFromQueueEntry);
    const [first, ...rest] = playables;
    if (!first) return;

    void actions.play(first);
    if (rest.length > 0) actions.enqueue(...rest);
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end gap-6">
        <CoverStack artworkUrls={playlist.artworkUrls} title={playlist.title} size={160} />

        <div className="min-w-[240px] flex-1">
          <PlaylistTitle playlistId={playlistId} title={playlist.title} />

          <p className="type-callout mt-1 mb-0 text-[var(--color-text-tertiary)]">
            {t.t('playlists.count', { count: playlist.episodeCount })}
          </p>

          {playlist.description ? (
            <p className="type-body mt-3 mb-0 max-w-[var(--measure-prose)] text-[var(--color-text-secondary)]">
              {playlist.description}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={playAll} disabled={order.length === 0}>
              {t.t('playlists.playAll')}
            </Button>

            <Button
              variant="ghost"
              busy={destroy.isPending}
              onClick={() => {
                // A native confirm rather than a bespoke dialog: this is the one
                // destructive action in the app, it is rare, and a real modal
                // here would be a focus trap and a scroll lock for a question
                // the platform already asks well.
                if (!window.confirm(t.t('playlists.deleteConfirm', { title: playlist.title }))) {
                  return;
                }
                destroy.mutate();
              }}
            >
              {t.t('playlists.delete')}
            </Button>
          </div>
        </div>
      </header>

      {order.length === 0 ? (
        <Notice heading={t.t('playlists.noEpisodes')} body={t.t('playlists.noEpisodesBody')} />
      ) : (
        <Reorder.Group
          axis="y"
          values={order}
          onReorder={(next: PlaylistEntry[]) => {
            setOrder(next);
            reorder.mutate(next.map((item) => item.episode.id));
          }}
          className="m-0 list-none p-0"
        >
          <AnimatePresence initial={false}>
            {order.map((entry, index) => (
              <PlaylistRow
                key={entry.episode.id}
                entry={entry}
                position={index + 1}
                onRemove={() => remove.mutate(entry.episode.id)}
              />
            ))}
          </AnimatePresence>
        </Reorder.Group>
      )}
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

function PlaylistRow({
  entry,
  position,
  onRemove,
}: {
  entry: PlaylistEntry;
  position: number;
  onRemove: () => void;
}) {
  const t = useTranslator();
  const actions = usePlayerActions();
  const controls = useDragControls();

  /**
   * How the *other* rows move while one is in hand.
   *
   * The drag itself is left alone under reduced motion — a finger is doing that
   * movement, and stopping it would break the feature rather than calm it. It
   * is the reflow around it that becomes a jump instead of a glide.
   */
  const settle = useTransition('standard');

  const playable = playableFromQueueEntry(entry);
  const tint = entry.accentColor ? deriveTint(entry.accentColor, 'dark') : null;
  const length = t.duration(entry.episode.durationSec);

  return (
    <Reorder.Item
      value={entry}
      // Started from the handle, not the row: the row holds a link and two
      // buttons, and a whole-row drag makes every one of them feel unreliable.
      dragListener={false}
      dragControls={controls}
      exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
      transition={{ ...settle, opacity: { duration: duration.fast / 1000 } }}
      className="flex items-center gap-3 border-b border-[var(--color-border)] py-3 last:border-b-0"
      whileDrag={{
        boxShadow: 'var(--elevation-3)',
        backgroundColor: 'var(--color-surface-raised)',
        cursor: 'grabbing',
      }}
    >
      <button
        type="button"
        onPointerDown={(event) => controls.start(event)}
        aria-label={t.t('queue.reorder', { title: entry.episode.title })}
        className="flex h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center border-none bg-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
          <path d="M9 6.5h1.5V8H9zM13.5 6.5H15V8h-1.5zM9 11.25h1.5v1.5H9zM13.5 11.25H15v1.5h-1.5zM9 16h1.5v1.5H9zM13.5 16H15v1.5h-1.5z" />
        </svg>
      </button>

      <span
        className="type-caption w-5 shrink-0 text-end text-[var(--color-text-tertiary)]"
        aria-hidden="true"
      >
        {position}
      </span>

      <Artwork
        src={entry.episode.artworkUrl ?? entry.podcastArtworkUrl}
        alt={entry.podcastTitle}
        size={44}
      />

      <div className="min-w-0 flex-1">
        <Link
          href={`/episode/${entry.episode.id}` as Route}
          className="type-body-strong clamp-1 m-0 text-[var(--color-text-primary)] no-underline hover:underline"
        >
          {entry.episode.title}
        </Link>
        <p className="type-caption mt-0.5 mb-0 text-[var(--color-text-tertiary)]">
          {entry.podcastTitle}
          {length ? <span aria-hidden="true"> · </span> : null}
          {length}
        </p>
      </div>

      <button
        type="button"
        onClick={() => void actions.play(playable)}
        className="type-caption shrink-0 cursor-pointer rounded-[var(--radius-sm)] border-none bg-transparent px-3 py-2 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        style={tint ? { color: tint.text } : undefined}
      >
        {t.t('episode.play')}
      </button>

      <button
        type="button"
        onClick={onRemove}
        aria-label={t.t('playlists.removeTitle', { title: entry.episode.title })}
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </Reorder.Item>
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
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center">
      <p className="type-title3 m-0 text-[var(--color-text-primary)]">{heading}</p>
      <p className="type-callout mx-auto mt-2 mb-0 max-w-[var(--measure-prose)] text-[var(--color-text-secondary)]">
        {body}
      </p>
      {children ? <div className="mt-5 flex justify-center">{children}</div> : null}
    </div>
  );
}
