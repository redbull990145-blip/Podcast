'use client';

import { isWrongPlaylistKind, queryKeys } from '@cue/api-client';
import { duration } from '@cue/motion';
import type { Playlist } from '@cue/types';
import { PLAYLIST_TITLE_MAX } from '@cue/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useRef, useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useTransition } from '@/lib/motion';
import { useSession } from '@/lib/session';

/**
 * Put this whole show in a playlist.
 *
 * The sheet lists *every* playlist, not only the ones that could take a show.
 * Hiding the episode playlists would be the tidier implementation and the worse
 * product: someone who made "Long drives" last week and is now looking at a
 * podcast will go looking for it, and a list where it is simply absent reads as
 * a bug in the list rather than as a rule about what it holds.
 *
 * So the rule is stated when it is reached, by the server, and the answer to it
 * is one tap — see `Refusal`.
 *
 * Absent entirely when signed out. Playlists live on the account, and a control
 * whose only outcome is a sign-in prompt is a control that wasted a tap.
 */
export function AddPodcastToPlaylist({
  podcastId,
  podcastTitle,
}: {
  podcastId: string;
  podcastTitle: string;
}) {
  const t = useTranslator();
  const { isSignedIn } = useSession();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Dismissal.
   *
   * Pointer-down rather than click, so a press that begins outside closes the
   * popover immediately instead of waiting for the release — and Escape,
   * because a popover that can only be dismissed with a mouse is unusable from
   * a keyboard.
   */
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!isSignedIn) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="true"
        className="type-body min-h-11 cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-transparent px-5 text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
      >
        {t.t('playlists.addShowTo')}
      </button>

      <AnimatePresence>
        {open ? <Sheet podcastId={podcastId} podcastTitle={podcastTitle} /> : null}
      </AnimatePresence>
    </div>
  );
}

function Sheet({ podcastId, podcastTitle }: { podcastId: string; podcastTitle: string }) {
  const t = useTranslator();
  const queryClient = useQueryClient();
  const enter = useTransition('responsive');
  const tick = useTransition('snappy');

  /** The playlist that just refused this show, if one did. */
  const [refused, setRefused] = useState<Playlist | null>(null);
  /** The show playlist we made to fix it, so the sheet can say where it went. */
  const [rescued, setRescued] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const playlists = useQuery({
    queryKey: queryKeys.playlists.list(),
    queryFn: () => api.listPlaylists({ limit: 100 }),
  });

  const membership = useQuery({
    queryKey: queryKeys.playlists.containingPodcast(podcastId),
    queryFn: () => api.playlistsContainingPodcast(podcastId),
  });

  const held = new Set(membership.data?.playlistIds ?? []);

  const invalidate = () => {
    // Everything under `playlists` — the list's counts and covers change
    // alongside the membership this row just edited.
    void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
  };

  const toggle = useMutation({
    mutationFn: async ({ playlist, add }: { playlist: Playlist; add: boolean }) => {
      if (add) await api.addPodcastToPlaylist(playlist.id, podcastId);
      else await api.removePodcastFromPlaylist(playlist.id, podcastId);
    },
    onMutate: ({ playlist }) => {
      // A new attempt clears whatever the last one said, so a stale refusal
      // cannot sit under a tap that has since succeeded.
      setRefused(null);
      setRescued(null);
      void playlist;
    },
    onError: (error, { playlist }) => {
      // The refusal this whole `kind` distinction exists for. Recognised by the
      // server's fields rather than by its prose — see `isWrongPlaylistKind`.
      if (isWrongPlaylistKind(error)) setRefused(playlist);
    },
    onSettled: invalidate,
  });

  /**
   * The way out of the refusal: make the right playlist and put the show in it.
   *
   * One mutation rather than a create the user then has to find and tap again.
   * The offer already named what it would do, so doing half of it and leaving
   * the rest on the floor would be the surprising outcome.
   */
  const rescue = useMutation({
    mutationFn: async (from: Playlist) => {
      const name = t.t('playlists.shows', { title: from.title });
      const { playlist } = await api.createPlaylist({
        title: name.slice(0, PLAYLIST_TITLE_MAX),
        kind: 'podcast',
        // Inherits the look of the playlist it was suggested from, so the pair
        // reads as related rather than as one list and one accident.
        color: from.banner.color,
      });
      await api.addPodcastToPlaylist(playlist.id, podcastId);
      return playlist;
    },
    onSuccess: (playlist) => {
      setRefused(null);
      setRescued(playlist.title);
    },
    onSettled: invalidate,
  });

  const create = useMutation({
    mutationFn: async (name: string) => {
      // A name typed while a show is in hand is a name for a show playlist.
      // Asking the kind question here would be asking a question already
      // answered by what the person is holding.
      const { playlist } = await api.createPlaylist({ title: name, kind: 'podcast' });
      await api.addPodcastToPlaylist(playlist.id, podcastId);
    },
    onSettled: invalidate,
  });

  return (
    <m.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      // Springs move things; tweens fade things — the package's own rule.
      // Opacity riding the responsive spring overshoots past 1, the compositor
      // clamps, and the entry flickers.
      transition={{ ...enter, opacity: { duration: duration.fast / 1000 } }}
      role="group"
      aria-label={t.t('playlists.addShowTo')}
      className="absolute top-[calc(100%+8px)] start-0 z-30 w-[300px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-overlay)] p-2"
      style={{ boxShadow: 'var(--elevation-lg)' }}
    >
      {refused ? (
        <Refusal
          playlist={refused}
          busy={rescue.isPending}
          onFix={() => rescue.mutate(refused)}
          onDismiss={() => setRefused(null)}
        />
      ) : null}

      {rescued ? (
        <p
          role="status"
          className="type-caption m-0 rounded-[var(--radius-sm)] bg-[var(--color-accent-muted)] px-3 py-2 text-[var(--color-text-primary)]"
        >
          {t.t('playlists.wrongKindDone', { title: rescued })}
        </p>
      ) : null}

      {playlists.isPending ? (
        <p className="type-caption m-0 px-3 py-2 text-[var(--color-text-tertiary)]">
          {t.t('common.loading')}
        </p>
      ) : (
        <ul className="m-0 max-h-[240px] list-none overflow-y-auto p-0">
          {(playlists.data?.items ?? []).map((playlist) => {
            const inIt = held.has(playlist.id);

            return (
              <li key={playlist.id}>
                <button
                  type="button"
                  onClick={() => toggle.mutate({ playlist, add: !inIt })}
                  aria-pressed={inIt}
                  className="flex w-full min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] border-none bg-transparent px-3 text-start transition-colors hover:bg-[var(--color-surface-hover)] transition-transform duration-[var(--duration-instant)] ease-standard active:scale-[0.98] motion-reduce:active:scale-100"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-5 w-5 shrink-0 items-center justify-center"
                  >
                    {inIt ? (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-[var(--color-accent-text)]"
                      >
                        {/* Drawn on, not popped in. A tick that simply appears
                            reads as a label changing; one that draws reads as a
                            mark being made. */}
                        <m.path
                          d="M5 12.5 9.5 17 19 7.5"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={tick}
                        />
                      </svg>
                    ) : null}
                  </span>

                  <span className="type-body clamp-1 flex-1 text-[var(--color-text-primary)]">
                    {playlist.title}
                  </span>

                  {/* The kind, stated on every row that cannot take a show. Not
                      a disabled row — see the note at the top of this file —
                      but not an unmarked one either. */}
                  {playlist.kind === 'episode' ? (
                    <span className="type-caption shrink-0 text-[var(--color-text-tertiary)]">
                      {t.t('playlists.kindEpisode')}
                    </span>
                  ) : (
                    <span className="type-caption shrink-0 text-[var(--color-text-tertiary)]">
                      {playlist.itemCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const name = title.trim();
          if (name.length === 0) return;
          create.mutate(name);
          setTitle('');
        }}
        className="mt-2 border-t border-[var(--color-border)] pt-2"
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t.t('playlists.create')}
          maxLength={PLAYLIST_TITLE_MAX}
          aria-label={t.t('playlists.create')}
          className="type-body min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[var(--color-text-primary)]"
        />
      </form>

      <span className="sr-only">{podcastTitle}</span>
    </m.div>
  );
}

/**
 * "That one holds episodes."
 *
 * Two things in one panel, in this order: what went wrong, then the way out.
 * An error that only says no leaves someone to work out that show playlists
 * exist, go and make one, come back, and find this show again — which is four
 * steps to recover from a rule they had no way to know about.
 *
 * `role="alert"` so it is announced the moment it appears. This is the response
 * to a tap that appeared to do nothing, which is precisely the case a screen
 * reader user cannot see.
 */
function Refusal({
  playlist,
  busy,
  onFix,
  onDismiss,
}: {
  playlist: Playlist;
  busy: boolean;
  onFix: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslator();

  return (
    <div
      role="alert"
      className="mb-2 rounded-[var(--radius-sm)] border border-[var(--color-danger)] p-3"
    >
      <p className="type-caption m-0 text-[var(--color-text-primary)]">
        {t.t('playlists.wrongKind')}
      </p>
      <p className="type-caption mt-1 mb-0 text-[var(--color-text-secondary)]">
        {t.t('playlists.wrongKindBody', { title: playlist.title })}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" busy={busy} onClick={onFix}>
          {t.t('playlists.wrongKindFix')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDismiss}>
          {t.t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
