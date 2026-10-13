'use client';

import { queryKeys, staleTime } from '@cue/api-client';
import type { Podcast, RecommendationReason, RecommendedPodcast } from '@cue/types';
import type { Translator } from '@cue/i18n';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Artwork } from '@/components/media/artwork';
import { PagedRail } from '@/components/ui/paged-rail';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * A shortlist, not a listing.
 *
 * This section was once the whole catalogue re-ordered — eighteen covers in a
 * five-column grid, which is a *listing*, and a listing cannot recommend
 * anything: eighteen equally-sized tiles ask the reader to do the choosing,
 * which is the job the ranking was supposed to have already done. That is
 * still the rule, and it is why this is capped at all.
 *
 * The number was three, on the reasoning that three cards *at editorial size*
 * could each carry a reason and enough artwork to recognise a show by. The
 * size is what moved: at three across, a cover on a desktop window was very
 * nearly the 400px this app reserves for the expanded player, spent on a
 * suggestion.
 *
 * Six in the shelf, three on screen. `PagedRail` keeps the other half behind a
 * chevron, which is how both halves of that argument survive: the row on screen
 * stays short enough to read as advice, and "more" is not immediately a dead
 * end. The same shape as Latest episodes below, so the two rails read as one
 * object at one size rather than two opinions about how many is right.
 */
const RAIL = 6;
/** How many of those are on screen at once. */
const PER_PAGE = 3;

/**
 * Roughly how many episodes it takes before the ranker stops guessing.
 *
 * Approximate on purpose. The server's threshold is a weighted total, not a
 * count — a finished episode is worth several abandoned ones — so no single
 * number is exactly right. This is the honest round figure to put in front of
 * someone, and it is deliberately small: the promise has to be one an evening
 * can keep.
 */
const EPISODES_TO_LEARN = 4;

/**
 * Recommended for you.
 *
 * Every card says why it is there. A rail of covers with no explanation is
 * indistinguishable from a rail of random covers, which was the original
 * complaint about this section, and no amount of better ranking fixes it if
 * the reasoning stays invisible.
 *
 * **A cold start is a state, not an absence.** The obvious handling — hide the
 * section until there is history to rank — is wrong twice over: it makes the
 * app look emptier exactly when a new listener is deciding whether to stay,
 * and it never tells them the feature exists or what would switch it on. So a
 * new account gets the same three cards, honestly captioned as popular rather
 * than as personal, plus one line saying what to do about it. The section then
 * changes under them as they listen, which is the feature demonstrating itself.
 *
 * Signed out it is the same shape again, from the shared catalogue, with no
 * invitation attached — there is nowhere to put history without an account.
 */
export function Recommended({ fallback }: { fallback: Podcast[] }) {
  const t = useTranslator();
  const { isSignedIn } = useSession();

  const { data } = useQuery({
    queryKey: queryKeys.library.recommendations(),
    queryFn: () => api.getRecommendations({ limit: RAIL }),
    // Nothing to personalise against for an anonymous visitor, and the
    // endpoint would 401 — so this is the one request Home does not make.
    enabled: isSignedIn,
    staleTime: staleTime.recommendations,
    // A rail is not worth a retry storm. If it fails the catalogue is right
    // there underneath it, and the reader loses an ordering, not a page.
    retry: false,
  });

  /*
    From the envelope, not counted from the rows.

    The endpoint always returns a full rail — a cold start falls back to
    catalogue quality rather than to an empty box — so `items.length > 0` is
    true for a listener it knows nothing about. Reading the flag is the
    difference between claiming an order is personal and offering to make it so.
  */
  const personalized = data?.personalized ?? false;
  const items = data?.items ?? [];

  const shows: RecommendedPodcast[] =
    items.length > 0
      ? items
      : fallback.slice(0, RAIL).map((podcast) => ({
          ...podcast,
          reason: { kind: 'popular', subject: null } as const,
        }));

  if (shows.length === 0) return null;

  return (
    <section aria-labelledby="recommended-heading" className="mb-14">
      <PagedRail
        headingId="recommended-heading"
        label={t.t('home.recommended')}
        // Only claimed when it is true. Telling a listener with no history
        // that this was shaped by their listening is the kind of small lie
        // that makes the whole feature read as decoration.
        note={personalized ? t.t('home.recommendedNote') : t.t('home.recommendedGeneric')}
        action={{ href: '/search', label: t.t('home.viewMore') }}
        perPage={PER_PAGE}
        items={shows.map((podcast) => (
          <li key={podcast.id}>
            <RecommendationCard podcast={podcast} />
          </li>
        ))}
      />


      {isSignedIn && !personalized ? <StartLearning /> : null}
    </section>
  );
}

/**
 * The invitation, for an account with nothing behind it yet.
 *
 * Under the cards rather than instead of them. Put above, it would be a
 * setup task standing between someone and the three shows they could press
 * play on right now — and the way to complete the task *is* to press play on
 * one of them, so the cards are the call to action and this is only the
 * caption explaining what it leads to.
 *
 * It says what will happen, not what to do: "listen to a few and this becomes
 * yours" is a description of the mechanism, which is both true and the only
 * version a reader can decide to believe. There is no button, because there is
 * no separate thing to press — every cover above it already is one.
 */
function StartLearning() {
  const t = useTranslator();

  return (
    <p className="type-callout mt-7 mb-0 max-w-[56ch] border-t border-[var(--color-border)] pt-5 text-[var(--color-text-secondary)]">
      {t.t('home.recommendedLearning', { count: EPISODES_TO_LEARN })}{' '}
      <Link
        href={'/search' as Route}
        className="text-[var(--color-accent-text)] underline-offset-4 hover:underline"
      >
        {t.t('home.recommendedBrowse')}
      </Link>
    </p>
  );
}

/**
 * One recommendation.
 *
 * Artwork-led like every other show tile in the app — no card chrome, no
 * border, no raised surface. The only thing distinguishing this from a
 * catalogue tile is scale and the reason above the title, which is exactly the
 * difference being claimed.
 */
function RecommendationCard({ podcast }: { podcast: RecommendedPodcast }) {
  const t = useTranslator();

  const meta = [
    podcast.author,
    podcast.episodeCount === null
      ? null
      : t.t('podcast.episodeCount', { count: podcast.episodeCount }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link href={`/podcast/${podcast.id}` as Route} className="group block no-underline">
      <div className="cue-artwork-feedback">
        <Artwork
          src={podcast.artworkUrl}
          alt={podcast.title}
          size={220}
          priority
          responsive
          // Kept in step with the grid above, so the browser is not asked for a
          // 33vw file to paint into a 20vw box.
          sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 46vw"
        />
      </div>

      {/* The one place besides Continue listening where the accent is spent on
          text, and for the same reason: it marks the sentence the section is
          *making*, not the content it is made of. */}
      <p className="type-overline clamp-1 mt-3.5 mb-1 text-[var(--color-accent-text)]">
        {reasonLabel(podcast.reason, t)}
      </p>

      <h3 className="type-title3 clamp-2 m-0 text-[var(--color-text-primary)]">
        {podcast.title}
      </h3>

      {meta ? (
        <p className="type-caption clamp-1 mt-1 mb-0 text-[var(--color-text-tertiary)]">
          {meta}
        </p>
      ) : null}
    </Link>
  );
}

/**
 * The reason, as a sentence in the reader's language.
 *
 * The server sends a fact — which signal won, and what it was — rather than a
 * finished phrase, because it does not know the locale. Assembling it here is
 * also what keeps "More in Business" from being four separate string
 * concatenations in four catalogs.
 */
function reasonLabel(reason: RecommendationReason, t: Translator): string {
  if (reason.kind === 'category' && reason.subject) {
    return t.t('home.becauseCategory', { subject: reason.subject });
  }
  if (reason.kind === 'creator' && reason.subject) {
    return t.t('home.becauseCreator', { subject: reason.subject });
  }
  return t.t('home.becausePopular');
}
