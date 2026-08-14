'use client';

import { queryKeys } from '@cue/api-client';
import { playableFromQueueEntry } from '@cue/core';
import type { Translator } from '@cue/i18n';
import { useTranslator } from '@/components/i18n/locale-provider';
import { deriveTint } from '@cue/design';
import type { ContinueEntry } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { Artwork } from '@/components/media/artwork';
import { api } from '@/lib/api';
import { usePlayerActions } from '@/lib/player/store';
import { useSession } from '@/lib/session';

/**
 * Pick up where you left off.
 *
 * This leads Home because it is the answer to why someone opened the app. A
 * catalogue grid answers "what exists"; almost nobody arrives asking that.
 * They arrive half way through something.
 *
 * Deliberately **not** a carousel. The first entry gets a card and the rest get
 * rows, because these are not peers — the one you touched most recently is
 * overwhelmingly the one you want, and giving four episodes identical framing
 * makes the reader do the ranking the data already did.
 *
 * Absent entirely when there is nothing in progress. A section header above an
 * empty rail is chrome advertising a feature you have not reached.
 */
export function ContinueListening() {
  const t = useTranslator();
  const { isSignedIn } = useSession();

  const { data } = useQuery({
    queryKey: queryKeys.library.continue(),
    queryFn: () => api.getContinue(4),
    enabled: isSignedIn,
    // Position moves constantly while listening, and this is the one screen
    // where a stale figure is visible as a progress bar in the wrong place.
    staleTime: 30_000,
  });

  const items = data?.items ?? [];
  const [lead, ...rest] = items;

  if (!lead) return null;

  return (
    <section aria-labelledby="continue-heading" className="mb-14">
      <h2
        id="continue-heading"
        className="type-overline mb-4 text-[var(--color-text-tertiary)]"
      >
        {t.t('home.continue')}
      </h2>

      <LeadCard entry={lead} />

      {rest.length > 0 ? (
        <ul className="mt-2 list-none p-0">
          {rest.map((entry) => (
            <li key={entry.episode.id}>
              <CompactRow entry={entry} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * How much is left, and how far along — the two facts that decide "now?".
 *
 * The translator is a parameter because this is a plain function, not a
 * component, and a hook cannot be called from one. Passing it in is also what
 * keeps this testable without a React tree.
 */
function remainingOf(
  entry: ContinueEntry,
  t: Translator,
): { left: string | null; fraction: number } {
  const total = entry.durationSec ?? entry.episode.durationSec;
  if (total === null || total <= 0) return { left: null, fraction: 0 };

  const remaining = Math.max(0, total - entry.positionSec);
  return {
    left: t.duration(remaining),
    fraction: Math.min(1, Math.max(0, entry.positionSec / total)),
  };
}

function LeadCard({ entry }: { entry: ContinueEntry }) {
  const t = useTranslator();
  const { play } = usePlayerActions();
  const { left, fraction } = remainingOf(entry, t);
  const tint = entry.accentColor ? deriveTint(entry.accentColor, 'dark') : null;

  return (
    <article
      className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]"
      // The show's own colour, at wash strength — felt as warmth behind the
      // card rather than seen as a coloured panel.
      style={tint ? { backgroundColor: tint.wash } : undefined}
    >
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <Artwork
          src={entry.episode.artworkUrl ?? entry.podcastArtworkUrl}
          alt={entry.podcastTitle}
          size={112}
          priority
        />

        <div className="min-w-0 flex-1">
          <p className="type-caption clamp-1 m-0 text-[var(--color-text-secondary)]">
            {entry.podcastTitle}
          </p>

          <h3 className="type-title3 m-0 mt-1">
            <Link
              href={`/episode/${entry.episode.id}` as Route}
              className="clamp-2 text-[var(--color-text-primary)] no-underline hover:underline"
            >
              {entry.episode.title}
            </Link>
          </h3>

          <div className="mt-4 flex items-center gap-4">
            <button
              type="button"
              onClick={() => void play(playableFromQueueEntry(entry))}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border-0 px-5 type-body-strong text-[var(--color-text-on-accent)]"
              style={{ backgroundColor: tint?.fill ?? 'var(--color-accent)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
              </svg>
              {t.t('episode.play')}
            </button>

            {left ? (
              <span className="type-caption text-[var(--color-text-secondary)]">
                {t.t('home.timeLeft', { duration: left })}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* A hairline along the foot of the card. It reads as progress without
          needing a label, and it is the same shape the player uses — so the
          two are recognisably the same idea. */}
      <div
        aria-hidden="true"
        className="h-[3px] w-full bg-[var(--color-border)]"
      >
        <div
          className="h-full origin-left"
          style={{
            width: `${fraction * 100}%`,
            backgroundColor: tint?.fill ?? 'var(--color-accent)',
          }}
        />
      </div>
    </article>
  );
}

function CompactRow({ entry }: { entry: ContinueEntry }) {
  const t = useTranslator();
  const { play } = usePlayerActions();
  const { left, fraction } = remainingOf(entry, t);

  return (
    <div className="flex items-center gap-4 border-b border-[var(--color-border)] py-3 last:border-b-0">
      <Artwork
        src={entry.episode.artworkUrl ?? entry.podcastArtworkUrl}
        alt={entry.podcastTitle}
        size={44}
      />

      <div className="min-w-0 flex-1">
        <p className="type-body-strong clamp-1 m-0 text-[var(--color-text-primary)]">
          {entry.episode.title}
        </p>
        <p className="type-caption clamp-1 mt-0.5 mb-0 text-[var(--color-text-tertiary)]">
          {entry.podcastTitle}
          {left ? <span aria-hidden="true"> · </span> : null}
          {left ? t.t('home.timeLeft', { duration: left }) : null}
        </p>
      </div>

      {/* A ring rather than a bar: at this size a 44px bar reads as a divider,
          and the ring sits comfortably inside the same 44px touch target the
          button already needs. */}
      <button
        type="button"
        onClick={() => void play(playableFromQueueEntry(entry))}
        aria-label={t.t('home.resume', { title: entry.episode.title })}
        className="relative flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
      >
        <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke="var(--color-border-strong)"
            strokeWidth="2"
          />
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            // Drawn from the top, clockwise, like every other progress ring
            // anyone has seen. Without the rotation it starts at three o'clock.
            transform="rotate(-90 16 16)"
            strokeDasharray={`${fraction * 2 * Math.PI * 14} ${2 * Math.PI * 14}`}
          />
          <path
            d="M13 11.5v9l7-4.5z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}
