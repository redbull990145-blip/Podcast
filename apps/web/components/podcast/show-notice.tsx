'use client';

import { queryKeys, staleTime } from '@cue/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslator } from '@/components/i18n/locale-provider';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * The one line this show has to say to you right now, if it has one.
 *
 * Two situations, one strip, because they are mutually exclusive and both are
 * about the relationship between you and a show you did not curate:
 *
 *  - **You cannot play this yet.** It came out of the directory rather than the
 *    catalogue, and playing those needs an account.
 *  - **You have been listening and have not kept it.** A show found through
 *    search is easy to lose: it is not in your library, so the only way back is
 *    to remember what you searched for. Offering to keep it at the point where
 *    it is demonstrably worth keeping — after you have listened, not before —
 *    is the difference between a prompt and a nag.
 *
 * Neither is shown speculatively. The second in particular waits for evidence:
 * real playback progress on a real episode of this show, read from the same
 * endpoint that drives Continue Listening.
 */
export function ShowNotice({
  podcastId,
  source,
  tint,
}: {
  podcastId: string;
  /** `directory` means somebody found this by searching. */
  source: 'seed' | 'directory';
  tint?: string | undefined;
}) {
  const t = useTranslator();
  const { isSignedIn, isLoading } = useSession();
  const queryClient = useQueryClient();

  const { data: subscription } = useQuery({
    queryKey: queryKeys.library.isSubscribed(podcastId),
    queryFn: () => api.isSubscribed(podcastId),
    enabled: isSignedIn,
    staleTime: staleTime.podcast,
  });

  /**
   * Have they actually listened to any of this?
   *
   * Only asked once there is a reason for the answer to matter — signed in, and
   * not already following. Someone who follows the show needs no nudge, and
   * asking anyway would be a request per page view to decide not to render
   * anything.
   */
  const { data: progress } = useQuery({
    queryKey: queryKeys.library.continue(),
    queryFn: () => api.getContinue(50),
    enabled: isSignedIn && subscription?.subscribed === false,
    staleTime: staleTime.podcast,
  });

  const follow = useMutation({
    mutationFn: () => api.subscribe(podcastId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.isSubscribed(podcastId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.subscriptions() });
    },
  });

  // Nothing to say until the session is known. Rendering the sign-in prompt
  // during that moment would flash it at people who are already signed in.
  if (isLoading) return null;

  if (source === 'directory' && !isSignedIn) {
    return (
      <Notice tint={tint}>
        <p className="type-caption clamp-1 m-0 min-w-0 text-[var(--color-text-secondary)]">
          {t.t('podcast.needsAccount')}
        </p>
        <Link
          href={'/signin' as Route}
          className="type-body-strong shrink-0 whitespace-nowrap text-[var(--color-text-primary)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
        >
          {t.t('podcast.signIn')}
        </Link>
      </Notice>
    );
  }

  const listened =
    progress?.items.some((item) => item.episode.podcastId === podcastId) ?? false;

  if (!isSignedIn || subscription?.subscribed !== false || !listened || follow.isSuccess) {
    return null;
  }

  return (
    <Notice tint={tint}>
      <p className="type-caption clamp-1 m-0 min-w-0 text-[var(--color-text-secondary)]">
        {t.t('podcast.enjoying')}
      </p>
      <button
        type="button"
        onClick={() => follow.mutate()}
        disabled={follow.isPending}
        className="type-body-strong shrink-0 cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-[var(--color-text-primary)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current disabled:cursor-not-allowed disabled:opacity-60"
      >
        {follow.isPending ? t.t('search.adding') : t.t('podcast.addToLibrary')}
      </button>
    </Notice>
  );
}

/**
 * The chip the notice lives in.
 *
 * A pill at the same 44px height as Follow, not a bordered card — this used to
 * be a box with its own paragraph and its own boxed button stacked inside it,
 * which next to a single pill read as two controls arguing about which one was
 * the actual action. As a chip in the same row it reads as one decision:
 * Follow, or this shortcut to the same place.
 *
 * The sentence is clamped to one line rather than left to wrap, and the chip
 * has no fixed width — long copy truncates with an ellipsis instead of
 * stretching the pill until it dominates the row it is a guest in.
 */
function Notice({ children, tint }: { children: React.ReactNode; tint?: string | undefined }) {
  return (
    <div
      className="flex min-h-[44px] max-w-[340px] items-center gap-3 rounded-full border border-[var(--color-border)] px-4"
      // Tinted from the show's own cover, so the strip reads as belonging to
      // this page rather than as a system banner dropped onto it.
      style={tint ? { backgroundColor: `${tint}1f`, borderColor: `${tint}33` } : undefined}
    >
      {children}
    </div>
  );
}
