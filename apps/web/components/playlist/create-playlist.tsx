'use client';

import { queryKeys } from '@cue/api-client';
import { playlistPalettes } from '@cue/design';
import { duration } from '@cue/motion';
import type { PlaylistColor, PlaylistKind } from '@cue/types';
import { PLAYLIST_BANNER_TEXT_MAX, PLAYLIST_TITLE_MAX } from '@cue/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { PlaylistBanner } from '@/components/playlist/playlist-banner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useTransition } from '@/lib/motion';

/**
 * Making a playlist, in two steps.
 *
 * The kind is asked first and on its own screen, before there is a name field
 * to fill in. That ordering is the point: `kind` cannot be changed afterwards,
 * so it must not be something a person sets by not noticing a dropdown. Putting
 * it second — as a toggle beside the name — would make the irreversible choice
 * the easiest one to skip past.
 *
 * The colour and the caption *are* on the second step, because both are
 * reversible and neither is worth a third screen. They come with a live banner
 * so the choice is made by looking rather than by imagining.
 */
export function CreatePlaylist({ onCreated }: { onCreated?: (id: string) => void }) {
  const t = useTranslator();
  const queryClient = useQueryClient();
  // The disclosure's travel springs; its fade rides a plain tween, per the
  // house rule that opacity never rides an overshooting spring.
  const settle = useTransition('standard');

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PlaylistKind | null>(null);
  const [title, setTitle] = useState('');
  const [color, setColor] = useState<PlaylistColor>('ember');
  const [bannerText, setBannerText] = useState('');

  const close = () => {
    setOpen(false);
    setKind(null);
    setTitle('');
    setColor('ember');
    setBannerText('');
  };

  const create = useMutation({
    mutationFn: (input: {
      title: string;
      kind: PlaylistKind;
      color: PlaylistColor;
      bannerText: string | null;
    }) => api.createPlaylist(input),
    onSuccess: ({ playlist }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
      onCreated?.(playlist.id);
      close();
    },
  });

  return (
    <div>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
          // Always back to the question, even from a tab that only shows one
          // kind. Preselecting from context would be right about the answer
          // most of the time and silent the rest, and this is the one field
          // that cannot be corrected afterwards — so it is always asked.
          setKind(null);
        }}
      >
        {t.t('playlists.create')}
      </Button>

      {/*
        The panel unfolds rather than swapping in: height and opacity together,
        so whatever is below is pushed down by the thing that asked to be there
        instead of jumping. Collapsing on the way out keeps the exit honest —
        the panel leaves the way it arrived.
      */}
      <AnimatePresence initial={false}>
        {open ? (
          <m.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ ...settle, opacity: { duration: duration.fast / 1000 } }}
            className="mt-3 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]"
          >
            <div className="p-4">
              {kind === null ? (
                <KindChooser onChoose={setKind} onCancel={close} />
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = title.trim();
                    if (name.length === 0) return;
                    create.mutate({
                      title: name,
                      kind,
                      color,
                      bannerText: bannerText.trim() || null,
                    });
                  }}
                  className="flex flex-col gap-4"
                >
                  <PlaylistBanner
                    banner={{
                      kind: 'color',
                      color,
                      imageUrl: null,
                      text: bannerText.trim() || null,
                    }}
                    title={title || t.t('playlists.create')}
                    height={120}
                  />

                  <div className="flex flex-wrap gap-4">
                    <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
                      <span className="type-caption text-[var(--color-text-secondary)]">
                        {t.t('playlists.name')}
                      </span>
                      <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder={t.t('playlists.namePlaceholder')}
                        maxLength={PLAYLIST_TITLE_MAX}
                        // The field someone came here to fill in, and it
                        // appeared because they asked for it — so it takes the
                        // caret rather than making them click again.
                        autoFocus
                        className="type-body min-h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[var(--color-text-primary)]"
                      />
                    </label>

                    <label className="flex min-w-[180px] flex-1 flex-col gap-1.5">
                      <span className="type-caption text-[var(--color-text-secondary)]">
                        {t.t('playlists.bannerText')}
                      </span>
                      <input
                        value={bannerText}
                        onChange={(event) => setBannerText(event.target.value)}
                        placeholder={t.t('playlists.bannerTextPlaceholder')}
                        maxLength={PLAYLIST_BANNER_TEXT_MAX}
                        className="type-body min-h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[var(--color-text-primary)]"
                      />
                    </label>
                  </div>

                  <ColorPicker
                    label={t.t('playlists.bannerColor')}
                    value={color}
                    // The picker is nullable because the page wash needs a
                    // "leave it alone"; a banner always has a colour, so null
                    // is simply not reachable from this instance.
                    onChange={(next) => {
                      if (next) setColor(next);
                    }}
                  />

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="submit"
                      busy={create.isPending}
                      disabled={title.trim().length === 0}
                    >
                      {create.isPending ? t.t('playlists.creating') : t.t('playlists.create')}
                    </Button>

                    <Button type="button" variant="ghost" onClick={close}>
                      {t.t('common.cancel')}
                    </Button>

                    <span className="type-caption text-[var(--color-text-tertiary)]">
                      {kind === 'podcast'
                        ? t.t('playlists.kindPodcast')
                        : t.t('playlists.kindEpisode')}
                    </span>
                  </div>

                  {create.error ? (
                    <p role="alert" className="type-caption m-0 text-[var(--color-danger)]">
                      {create.error.message}
                    </p>
                  ) : null}
                </form>
              )}
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * "Episodes, or shows?"
 *
 * Two cards rather than a select, because this is the one decision on the
 * screen and it is permanent. A select would render it as a setting with a
 * default; two equally weighted cards render it as a question with no default,
 * which is what it is.
 */
function KindChooser({
  onChoose,
  onCancel,
}: {
  onChoose: (kind: PlaylistKind) => void;
  onCancel: () => void;
}) {
  const t = useTranslator();

  const options: { kind: PlaylistKind; label: string; body: string }[] = [
    {
      kind: 'episode',
      label: t.t('playlists.kindEpisode'),
      body: t.t('playlists.kindEpisodeBody'),
    },
    {
      kind: 'podcast',
      label: t.t('playlists.kindPodcast'),
      body: t.t('playlists.kindPodcastBody'),
    },
  ];

  return (
    <div>
      <p className="type-title3 m-0 text-[var(--color-text-primary)]">
        {t.t('playlists.forWhat')}
      </p>
      <p className="type-caption mt-1 mb-0 max-w-[var(--measure-prose)] text-[var(--color-text-tertiary)]">
        {t.t('playlists.forWhatBody')}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <button
            key={option.kind}
            type="button"
            onClick={() => onChoose(option.kind)}
            className="cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-start transition-[transform,background-color,border-color] duration-[var(--duration-instant)] ease-standard hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] active:scale-[0.99] motion-reduce:active:scale-100"
          >
            <span className="type-body-strong block text-[var(--color-text-primary)]">
              {option.label}
            </span>
            <span className="type-caption mt-1 block text-[var(--color-text-secondary)]">
              {option.body}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t.t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The six swatches.
 *
 * A radiogroup rather than a row of buttons, because that is what it is: one
 * choice out of a closed set. The difference is not cosmetic — a screen reader
 * announces "3 of 6" and the arrow keys move between swatches, neither of which
 * a pile of buttons gets.
 */
export function ColorPicker({
  label,
  value,
  onChange,
  allowNone = false,
}: {
  label: string;
  value: PlaylistColor | null;
  onChange: (color: PlaylistColor | null) => void;
  /** Adds a "leave it alone" option — only the page wash has one. */
  allowNone?: boolean;
}) {
  const t = useTranslator();

  return (
    <div role="radiogroup" aria-label={label}>
      <span className="type-caption block text-[var(--color-text-secondary)]">{label}</span>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {allowNone ? (
          <button
            type="button"
            role="radio"
            aria-checked={value === null}
            onClick={() => onChange(null)}
            className={`type-caption min-h-11 cursor-pointer rounded-full border px-4 transition-colors ${
              value === null
                ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:border-[var(--color-border-strong)]'
            } bg-transparent`}
          >
            {t.t('playlists.backgroundNone')}
          </button>
        ) : null}

        {playlistPalettes.map((palette) => {
          const selected = value === palette.id;

          return (
            <button
              key={palette.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={palette.label}
              onClick={() => onChange(palette.id)}
              className="h-11 w-11 cursor-pointer rounded-full border-none p-0 transition-transform duration-[var(--duration-instant)] ease-standard active:scale-[0.94] motion-reduce:active:scale-100"
              style={{
                background: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
                /*
                  The ring sits outside the swatch rather than inside it, so
                  selection never eats into the colour being judged.

                  Written here rather than as `outline-2 outline-offset-2`,
                  which renders nothing: those utilities set the outline's width
                  and offset but not its *style*, and the preflight reset leaves
                  `outline-style: none` — so the selected swatch looked exactly
                  like the other five.
                */
                outline: selected ? '2px solid var(--color-text-primary)' : 'none',
                outlineOffset: 2,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
