'use client';

import { queryKeys } from '@cue/api-client';
import { PLAYLIST_TITLE_MAX } from '@cue/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { CoverStack } from '@/components/playlist/cover-stack';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Every playlist this listener has.
 *
 * Signed-in only, and honestly so. A playlist is a thing you build over weeks
 * and expect to still be there — keeping one in local storage until the browser
 * decides otherwise would be worse than saying it needs an account.
 */
export function PlaylistsClient() {
  const t = useTranslator();
  const { isSignedIn, isLoading: sessionLoading } = useSession();

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.playlists.list(),
    queryFn: () => api.listPlaylists({ limit: 100 }),
    enabled: isSignedIn,
  });

  if (sessionLoading) return null;

  if (!isSignedIn) {
    return (
      <Empty heading={t.t('playlists.signedOut')} body={t.t('playlists.signedOutBody')}>
        <Link href={'/signin' as Route} className="no-underline">
          <Button>{t.t('common.signIn')}</Button>
        </Link>
      </Empty>
    );
  }

  if (error) {
    return <Empty heading={t.t('playlists.failed')} body={t.t('common.checkConnection')} />;
  }

  const playlists = data?.items ?? [];

  return (
    <div className="flex flex-col gap-8">
      <CreatePlaylist />

      {isPending ? null : playlists.length === 0 ? (
        <Empty heading={t.t('playlists.empty')} body={t.t('playlists.emptyBody')} />
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6 p-0">
          {playlists.map((playlist) => (
            <li key={playlist.id}>
              <Link
                href={`/playlists/${playlist.id}` as Route}
                className="group flex flex-col gap-3 no-underline"
              >
                <CoverStack
                  artworkUrls={playlist.artworkUrls}
                  title={playlist.title}
                  size={180}
                />

                <div className="min-w-0">
                  <p className="type-body-strong clamp-2 m-0 text-[var(--color-text-primary)] group-hover:underline">
                    {playlist.title}
                  </p>
                  <p className="type-caption mt-0.5 mb-0 text-[var(--color-text-tertiary)]">
                    {t.t('playlists.count', { count: playlist.episodeCount })}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Making one.
 *
 * A disclosure rather than a permanently open form: the common visit to this
 * screen is to open a playlist, not to create one, and an always-present pair
 * of empty fields pushes the actual content below the fold on a laptop.
 */
function CreatePlaylist() {
  const t = useTranslator();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  const create = useMutation({
    mutationFn: (name: string) => api.createPlaylist({ title: name }),
    onSuccess: () => {
      setTitle('');
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    },
  });

  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t.t('playlists.create')}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const name = title.trim();
        if (name.length === 0) return;
        create.mutate(name);
      }}
      className="flex flex-wrap items-end gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4"
    >
      <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
        <span className="type-caption text-[var(--color-text-secondary)]">
          {t.t('playlists.name')}
        </span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t.t('playlists.namePlaceholder')}
          maxLength={PLAYLIST_TITLE_MAX}
          // The one field on screen, and it appeared because someone asked for
          // it — so it takes the caret rather than making them click again.
          autoFocus
          className="type-body min-h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[var(--color-text-primary)]"
        />
      </label>

      <Button type="submit" busy={create.isPending} disabled={title.trim().length === 0}>
        {create.isPending ? t.t('playlists.creating') : t.t('playlists.create')}
      </Button>

      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setOpen(false);
          setTitle('');
        }}
      >
        {t.t('common.cancel')}
      </Button>

      {create.error ? (
        <p role="alert" className="type-caption m-0 basis-full text-[var(--color-danger)]">
          {create.error.message}
        </p>
      ) : null}
    </form>
  );
}

function Empty({
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
