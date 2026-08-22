'use client';

import { queryKeys } from '@cue/api-client';
import type { PlaylistColor, PlaylistDetail } from '@cue/types';
import {
  PLAYLIST_BANNER_TEXT_MAX,
  PLAYLIST_IMAGE_MAX_BYTES,
  PLAYLIST_IMAGE_TYPES,
} from '@cue/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { ColorPicker } from '@/components/playlist/create-playlist';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

/**
 * Dressing a playlist.
 *
 * Everything here writes immediately rather than collecting into a Save button.
 * The whole panel is about how something looks, the result is on screen behind
 * it, and a colour you have to commit to before you can see it is a colour you
 * are choosing blind. There is no destructive edit in here for a Save to guard.
 *
 * Every mutation is optimistic on the detail query for the same reason: a
 * swatch that stays unselected for a round trip reads as a swatch that did not
 * take the tap, and the second tap is what actually causes trouble.
 */
export function PlaylistAppearance({ playlist }: { playlist: PlaylistDetail }) {
  const t = useTranslator();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [bannerText, setBannerText] = useState(playlist.banner.text ?? '');
  /** Client-side upload complaints. Server failures ride on the mutation. */
  const [fileError, setFileError] = useState<string | null>(null);

  const detailKey = queryKeys.playlists.detail(playlist.id);

  /** Fold a server answer back into the cache without a refetch. */
  const settle = (next: { banner: PlaylistDetail['banner']; backgroundColor: PlaylistColor | null }) => {
    queryClient.setQueryData<{ playlist: PlaylistDetail }>(detailKey, (current) =>
      current
        ? {
            playlist: {
              ...current.playlist,
              banner: next.banner,
              backgroundColor: next.backgroundColor,
            },
          }
        : current,
    );
    // The tiles carry the banner too, so the grid is stale the moment this is.
    void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.list() });
  };

  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.updatePlaylist>[1]) =>
      api.updatePlaylist(playlist.id, input),
    onMutate: (input) => {
      // Paint it now. The server is authoritative and `onSuccess` re-folds its
      // answer; this only removes the round trip from between tap and colour.
      queryClient.setQueryData<{ playlist: PlaylistDetail }>(detailKey, (current) =>
        current
          ? {
              playlist: {
                ...current.playlist,
                banner: {
                  ...current.playlist.banner,
                  ...(input.color === undefined ? {} : { color: input.color }),
                  ...(input.bannerKind === undefined ? {} : { kind: input.bannerKind }),
                  ...(input.bannerText === undefined ? {} : { text: input.bannerText }),
                },
                ...(input.backgroundColor === undefined
                  ? {}
                  : { backgroundColor: input.backgroundColor }),
              },
            }
          : current,
      );
    },
    onSuccess: ({ playlist: saved }) => settle(saved),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadPlaylistBanner(playlist.id, file),
    onSuccess: ({ playlist: saved }) => settle(saved),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });

  const dropImage = useMutation({
    mutationFn: () => api.removePlaylistBanner(playlist.id),
    onSuccess: ({ playlist: saved }) => settle(saved),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });

  const hasImage = playlist.banner.imageUrl !== null;

  /**
   * Checked here as well as on the server.
   *
   * Not because the server's check is in doubt — it is the one that counts —
   * but because uploading five megabytes over a phone connection to be told no
   * is a minute of someone's life for an answer that was knowable instantly.
   */
  const choose = (file: File | undefined) => {
    if (!file) return;
    setFileError(null);

    if (!(PLAYLIST_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setFileError(t.t('playlists.imageWrongType'));
      return;
    }
    if (file.size > PLAYLIST_IMAGE_MAX_BYTES) {
      setFileError(
        t.t('playlists.imageTooBig', {
          mb: Math.round(PLAYLIST_IMAGE_MAX_BYTES / (1024 * 1024)),
        }),
      );
      return;
    }

    upload.mutate(file);
  };

  const error = fileError ?? upload.error?.message ?? update.error?.message ?? null;

  return (
    <div className="flex flex-col gap-6 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
      {/* --- which banner --- */}
      <div role="radiogroup" aria-label={t.t('playlists.banner')}>
        <span className="type-caption block text-[var(--color-text-secondary)]">
          {t.t('playlists.banner')}
        </span>

        <div className="mt-2 flex flex-wrap gap-2">
          {(['color', 'image'] as const).map((option) => {
            const selected = playlist.banner.kind === option;

            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                // Nothing to switch to until a picture exists — and the server
                // refuses this exact patch, so disabling it here is the same
                // rule stated where it can be seen rather than discovered.
                disabled={option === 'image' && !hasImage}
                onClick={() => update.mutate({ bannerKind: option })}
                className={`type-body min-h-11 cursor-pointer rounded-full border px-4 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected
                    ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:border-[var(--color-border-strong)]'
                } bg-transparent`}
              >
                {option === 'color'
                  ? t.t('playlists.bannerColor')
                  : t.t('playlists.bannerImage')}
              </button>
            );
          })}
        </div>
      </div>

      {/* --- the picture --- */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept={PLAYLIST_IMAGE_TYPES.join(',')}
          className="sr-only"
          onChange={(event) => {
            choose(event.target.files?.[0]);
            // Cleared so choosing the *same* file again still fires a change —
            // which is exactly what someone does after cropping it and trying
            // once more.
            event.target.value = '';
          }}
        />

        <Button
          type="button"
          variant="secondary"
          busy={upload.isPending}
          onClick={() => fileRef.current?.click()}
        >
          {upload.isPending
            ? t.t('playlists.uploading')
            : hasImage
              ? t.t('playlists.bannerReplace')
              : t.t('playlists.bannerUpload')}
        </Button>

        {hasImage ? (
          <Button
            type="button"
            variant="ghost"
            busy={dropImage.isPending}
            onClick={() => dropImage.mutate()}
          >
            {t.t('playlists.bannerRemove')}
          </Button>
        ) : null}
      </div>

      {/* --- the palette --- */}
      <ColorPicker
        label={t.t('playlists.bannerColor')}
        value={playlist.banner.color}
        onChange={(color) => {
          if (color) update.mutate({ color });
        }}
      />

      {/* --- the caption --- */}
      <label className="flex max-w-[360px] flex-col gap-1.5">
        <span className="type-caption text-[var(--color-text-secondary)]">
          {t.t('playlists.bannerText')}
        </span>
        <input
          value={bannerText}
          onChange={(event) => setBannerText(event.target.value)}
          // On blur rather than on every keystroke: a caption is typed, not
          // dragged, and a PATCH per character would be twenty writes to land
          // on one word.
          onBlur={() => {
            const next = bannerText.trim();
            if (next === (playlist.banner.text ?? '')) return;
            update.mutate({ bannerText: next || null });
          }}
          placeholder={t.t('playlists.bannerTextPlaceholder')}
          maxLength={PLAYLIST_BANNER_TEXT_MAX}
          className="type-body min-h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[var(--color-text-primary)]"
        />
      </label>

      {/* --- the page wash --- */}
      <ColorPicker
        label={t.t('playlists.background')}
        value={playlist.backgroundColor}
        allowNone
        onChange={(backgroundColor) => update.mutate({ backgroundColor })}
      />

      {error ? (
        <p role="alert" className="type-caption m-0 text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
