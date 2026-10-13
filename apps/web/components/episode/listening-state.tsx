'use client';

import { queryKeys } from '@cue/api-client';
import { TINT_ATTR, tintVars } from '@cue/design';
import type { EpisodeProgress } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Which of these episodes you have already heard.
 *
 * The plainest gap in the product before this existed: a show page listed three
 * hundred episodes and said nothing about which of them you had played, which
 * you were half way through, or which you had finished. Every other podcast app
 * answers that at a glance, and it is the difference between an archive you can
 * work through and a wall you have to remember your way around.
 *
 * **One request per list, not one per row.** The obvious shape — each row asks
 * about itself — is an N+1 against a route that needs authentication, and on a
 * ten-row archive that is ten round trips to draw ten three-pixel bars. The
 * provider asks once for the whole page and hands the answer down through
 * context, so adding the mark to another list costs one more query, not one
 * more query per item.
 *
 * **Absent means untouched.** The endpoint omits episodes it has no row for
 * rather than sending nulls, so a lookup that misses is the normal case and not
 * an error.
 */

const ListeningState = createContext<ReadonlyMap<string, EpisodeProgress> | null>(null);

/** Nothing to look up. Shared so an empty state is not a new object per render. */
const NONE: ReadonlyMap<string, EpisodeProgress> = new Map();

export function ListeningStateProvider({
  episodeIds,
  children,
}: {
  /** One page of a list. The endpoint caps this at 100. */
  episodeIds: readonly string[];
  children: ReactNode;
}) {
  const { isSignedIn } = useSession();

  const { data } = useQuery({
    queryKey: queryKeys.library.progress(episodeIds),
    queryFn: () => api.listProgress(episodeIds),
    // Signed out there is no history to have, and the endpoint would 401.
    enabled: isSignedIn && episodeIds.length > 0,
    /*
      Thirty seconds, matching Home's resume hero.

      Position moves constantly while listening and this is drawn as a bar whose
      length is the claim, so a stale figure is visible rather than merely old.
      It does not have to be perfect: `useNowPlayingSync` in the shell
      invalidates the whole `library` key the moment the player reports a new
      position, which is what makes an episode you just finished show its mark
      when you navigate back to the show.
    */
    staleTime: 30_000,
    // A missing mark is a smaller loss than a retry storm against an endpoint
    // having a bad day, and the rows underneath are perfectly usable without it.
    retry: false,
  });

  const byId = useMemo(() => {
    if (!data) return NONE;
    return new Map(data.items.map((item) => [item.episodeId, item] as const));
  }, [data]);

  return <ListeningState.Provider value={byId}>{children}</ListeningState.Provider>;
}

/** Null outside a provider, which is a list that has not opted in rather than a bug. */
function useProgress(episodeId: string): EpisodeProgress | null {
  return useContext(ListeningState)?.get(episodeId) ?? null;
}

/**
 * How far through an episode you are, drawn on its own cover.
 *
 * Two states and two different marks, because they answer two different
 * questions. *Part heard* is "how much is left", which is a quantity, so it is
 * a bar whose length is the answer. *Finished* is "is this done", which is a
 * yes, so it is a tick — and the cover behind it steps back, because a finished
 * episode should stop competing for attention with the ones you have not
 * reached.
 *
 * **The colour comes from the artwork**, like every other colour in this
 * product: `--tint-text`, which `deriveTint` fits to at least 4.5:1 against the
 * theme ground and holds there by test. A show with no usable hue falls through
 * to the accent, which is the one thing the mark is allowed to borrow from the
 * chrome — it is, after all, marking what has been played.
 *
 * **Never colour alone.** The bar carries a *length* and the tick carries a
 * *shape*, and the finished state additionally dims the cover. Someone who
 * cannot separate the two hues still has three signals left.
 */
export function ListeningMark({
  episodeId,
  /** The show's colour. The episode's own is not fetched for a list. */
  accentColor,
  durationSec,
}: {
  episodeId: string;
  accentColor?: string | null;
  /** Falls back to the duration the listener's own device observed. */
  durationSec?: number | null;
}) {
  const t = useTranslator();
  const progress = useProgress(episodeId);
  const tint = tintVars(accentColor);

  if (!progress) return null;

  const total = progress.durationSec ?? durationSec ?? null;
  const fraction =
    total !== null && total > 0
      ? Math.min(1, Math.max(0, progress.positionSec / total))
      : 0;

  // Started, but not far enough in for a bar to be honest about it. Drawing a
  // one-pixel sliver would claim precision the position does not have, and
  // saying nothing matches what the listener remembers: they have not started.
  if (!progress.completed && fraction < 0.01) return null;

  const spread = tint ? { [TINT_ATTR]: '', style: tint as React.CSSProperties } : {};
  const color = tint ? 'var(--tint-text)' : 'var(--color-accent)';

  if (progress.completed) {
    return (
      <span
        {...spread}
        // `inset-0` over the cover rather than a corner badge floating beside
        // it: the dimming is half the signal and it has to cover the artwork.
        className="pointer-events-none absolute inset-0 flex items-end justify-end rounded-[inherit] bg-[var(--color-bg)]/45 p-1"
      >
        <span className="sr-only">{t.t('episode.played')}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ color }}
        >
          <path d="m4 12.5 5.5 5.5L20 6" />
        </svg>
      </span>
    );
  }

  return (
    <span
      {...spread}
      className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-[inherit]"
    >
      <span className="sr-only">
        {t.t('episode.partHeard', { percent: Math.round(fraction * 100) })}
      </span>
      {/* The unfilled half is a scrim rather than a border colour: this sits on
          artwork we do not control, and a track that is legible on a black
          cover disappears on a white one. */}
      <span
        aria-hidden="true"
        className="block h-[3px] w-full rounded-b-[inherit] bg-black/35"
      >
        <span
          className="block h-full rounded-bl-[inherit]"
          style={{ width: `${fraction * 100}%`, backgroundColor: color }}
        />
      </span>
    </span>
  );
}
