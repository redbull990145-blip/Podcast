'use client';

import { queryKeys } from '@cue/api-client';
import { duration } from '@cue/motion';
import { PLAYLIST_TITLE_MAX } from '@cue/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useRef, useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { api } from '@/lib/api';
import { useTransition } from '@/lib/motion';
import { useSession } from '@/lib/session';

/**
 * Put this episode in a playlist.
 *
 * A popover of tick boxes rather than a "choose a playlist" page, because the
 * question is almost always *which of mine*, and the answer is usually more
 * than one. Membership arrives in a single request, so the ticks are right the
 * moment it opens rather than filling in one row at a time.
 *
 * Absent entirely when signed out. Playlists live on the account, and a control
 * whose only outcome is a sign-in prompt is a control that wasted a tap.
 */
export function AddToPlaylist({ episodeId }: { episodeId: string }) {
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
        {t.t('playlists.addTo')}
      </button>

      <AnimatePresence>{open ? <Sheet episodeId={episodeId} /> : null}</AnimatePresence>
    </div>
  );
}

function Sheet({ episodeId }: { episodeId: string }) {
  const t = useTranslator();
  const queryClient = useQueryClient();
  const enter = useTransition('responsive');
  // The tick's draw-on. Asked for unconditionally at the top — a hook after
  // the early returns would reorder on the first signed-out render.
  const tick = useTransition('snappy');

  const playlists = useQuery({
    queryKey: queryKeys.playlists.list(),
    queryFn: () => api.listPlaylists({ limit: 100 }),
  });

  const membership = useQuery({
    queryKey: queryKeys.playlists.containing(episodeId),
    queryFn: () => api.playlistsContaining(episodeId),
  });

  const held = new Set(membership.data?.playlistIds ?? []);

  const toggle = useMutation({
    // The two calls answer with different keys — `added` and `removed` — and
    // nothing here reads either, so the result is discarded rather than widened
    // into a union every caller would have to narrow.
    mutationFn: async ({ playlistId, add }: { playlistId: string; add: boolean }) => {
      if (add) await api.addToPlaylist(playlistId, episodeId);
      else await api.removeFromPlaylist(playlistId, episodeId);
    },
    onSettled: () => {
      // Everything under `playlists` — the list's counts and covers change
      // alongside the membership this row just edited.
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    },
  });

  const create = useMutation({
    mutationFn: async (title: string) => {
      const { playlist } = await api.createPlaylist({ title });
      // Created *and* filled: someone typing a name while an episode is in hand
      // is naming a playlist for that episode.
      await api.addToPlaylist(playlist.id, episodeId);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    },
  });

  const [title, setTitle] = useState('');

  return (
    <m.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      // Springs move things; tweens fade things — the package's own rule, and
      // this popover was breaking it. Opacity riding the responsive spring
      // overshoots past 1, the compositor clamps, and the entry flickers. The
      // spring keeps the travel; the fade gets a plain tween.
      transition={{ ...enter, opacity: { duration: duration.fast / 1000 } }}
      role="group"
      aria-label={t.t('playlists.addTo')}
      className="absolute top-[calc(100%+8px)] start-0 z-30 w-[280px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-overlay)] p-2"
      // lg, not a number that was never a token — `--elevation-3` resolved to
      // nothing, so the sheet floated with no shadow at all.
      style={{ boxShadow: 'var(--elevation-lg)' }}
    >
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
                  onClick={() => toggle.mutate({ playlistId: playlist.id, add: !inIt })}
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
                            mark being made — and `snappy` exists for exactly
                            this, near-instant without being a cut. */}
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

                  <span className="type-caption shrink-0 text-[var(--color-text-tertiary)]">
                    {playlist.episodeCount}
                  </span>
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
    </m.div>
  );
}
