'use client';

import { queryKeys, staleTime } from '@cue/api-client';
import { resolvePlaylistPalette } from '@cue/design';
import type { Playlist, PlaylistKind } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { CreatePlaylist } from '@/components/playlist/create-playlist';
import { CoverStack } from '@/components/playlist/cover-stack';
import { api } from '@/lib/api';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Every playlist of one kind, as tiles.
 *
 * Shared by the Library's playlists section and the standalone `/playlists`
 * screen, because they are the same list twice and a second copy would drift —
 * the version that was not being looked at would be the one that stopped
 * showing banners.
 */
export function PlaylistGrid({ kind }: { kind: PlaylistKind }) {
  const t = useTranslator();

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.playlists.list(kind),
    queryFn: () => api.listPlaylists({ limit: 100, kind }),
    staleTime: staleTime.podcast,
  });

  const playlists = data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* No `kind` passed: the question is asked every time, including here
          where the tab already implies an answer. See `CreatePlaylist`. */}
      <CreatePlaylist />

      {error ? (
        <Empty heading={t.t('playlists.failed')} body={t.t('common.checkConnection')} />
      ) : isPending ? (
        <Placeholder />
      ) : playlists.length === 0 ? (
        <Empty
          heading={kind === 'podcast' ? t.t('playlists.emptyShows') : t.t('playlists.empty')}
          body={
            kind === 'podcast' ? t.t('playlists.emptyShowsBody') : t.t('playlists.emptyBody')
          }
        />
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6 p-0">
          {playlists.map((playlist) => (
            <li key={playlist.id}>
              <PlaylistTile playlist={playlist} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One tile.
 *
 * The banner is the tile, not a strip above it. A playlist that someone has
 * dressed should be recognisable from across the grid — which is the whole
 * reason the banner exists — and a cover stack alone makes every playlist look
 * like the same four covers in a different order.
 *
 * The covers are still there, stacked small over the banner, because they are
 * what says *what is in it*. The banner says which one it is.
 */
function PlaylistTile({ playlist }: { playlist: Playlist }) {
  const t = useTranslator();
  const palette = resolvePlaylistPalette(playlist.banner.color);
  const [imageFailed, setImageFailed] = useState(false);

  const showsImage =
    playlist.banner.kind === 'image' && playlist.banner.imageUrl !== null && !imageFailed;

  return (
    <Link
      href={`/playlists/${playlist.id}` as Route}
      className="group flex flex-col gap-3 no-underline"
    >
      {/* The same lift-and-settle every artwork-led tile in the app gives, so a
          playlist reads as a peer of a show rather than as a different kind of
          object. */}
      <span className="block transition-transform duration-[var(--duration-fast)] ease-standard group-hover:-translate-y-0.5 group-active:translate-y-0 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
        <span
          className="relative isolate flex aspect-square w-full items-end overflow-hidden rounded-[var(--radius-md)]"
          style={{
            background: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
          }}
        >
          {showsImage ? (
            <img
              src={playlist.banner.imageUrl ?? ''}
              alt=""
              // A banner that 404s — a deleted picture a stale cache still
              // points at — falls back to the gradient rather than to a broken
              // image glyph. The colour is always there underneath.
              onError={() => setImageFailed(true)}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : null}

          {playlist.artworkUrls.length > 0 ? (
            <span className="relative m-3">
              <CoverStack
                artworkUrls={playlist.artworkUrls}
                title={playlist.title}
                size={72}
              />
            </span>
          ) : null}

          {playlist.banner.text ? (
            <>
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-1/2"
                style={{
                  background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)',
                }}
              />
              <span
                className="type-callout absolute inset-x-0 bottom-0 clamp-2 px-3 pb-2.5 text-end"
                style={{ color: '#FFFFFF', textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}
              >
                {playlist.banner.text}
              </span>
            </>
          ) : null}
        </span>
      </span>

      <div className="min-w-0">
        <p className="type-body-strong clamp-2 m-0 text-[var(--color-text-primary)] group-hover:underline">
          {playlist.title}
        </p>
        <p className="type-caption mt-0.5 mb-0 text-[var(--color-text-tertiary)]">
          {/* Two count strings rather than one with a noun slot: "3 shows" and
              "3 episodes" pluralise on different words, and every language this
              app ships does that differently. */}
          {playlist.kind === 'podcast'
            ? t.t('playlists.countShows', { count: playlist.itemCount })
            : t.t('playlists.count', { count: playlist.itemCount })}
        </p>
      </div>
    </Link>
  );
}

function Placeholder() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6"
    >
      {[0, 1, 2, 3].map((tile) => (
        <div key={tile}>
          <div className="aspect-square w-full rounded-[var(--radius-md)] bg-[var(--color-skeleton)]" />
          <div className="mt-3 h-[15px] w-[60%] rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
          <div className="mt-2 h-[13px] w-[30%] rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
        </div>
      ))}
    </div>
  );
}

function Empty({ heading, body }: { heading: string; body: string }) {
  return <EmptyState title={heading} body={body} />;
}
