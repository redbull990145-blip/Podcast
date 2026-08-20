'use client';

import { queryKeys, staleTime } from '@cue/api-client';
import type { Podcast } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import { useTranslator } from '@/components/i18n/locale-provider';
import { PodcastTile } from '@/components/podcast/podcast-tile';
import { SectionHeader } from '@/components/ui/section-header';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Kept in step with the `limit` Home fetches its fallback with. The two lists
 * occupy the same grid, and a rail that changes length when it personalises is
 * a layout shift for no reason.
 */
const RAIL = 18;

/**
 * Home's main grid — the catalogue, or the listener's own version of it.
 *
 * Deliberately **one section, not two**. The obvious implementation is a
 * "Recommended for you" rail above "Everything on Cue", and it is wrong here:
 * both are the same eighteen covers in the same grid, so the page would show
 * the same shows twice under two headings and make the reader work out which
 * one to trust. The personalisation is an *ordering*, and the honest way to
 * present an ordering is to change the order and say what it means.
 *
 * The catalogue arrives rendered from the server, because Home is a cached
 * static page and a shared catalogue is the same for everybody. Recommendations
 * cannot be: they are per-listener, so they are fetched on the client and swap
 * in over the top. That is why the fallback is a prop rather than a second
 * query — the reader never sees a skeleton, and never sees the grid jump,
 * because there is always something in it.
 *
 * Signed out, or if the request fails, this is exactly the section that was
 * here before.
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

  const items = data?.items ?? [];
  const personalized = items.length > 0;
  const shows = personalized ? items : fallback;

  if (shows.length === 0) return null;

  return (
    <section aria-labelledby="catalogue-heading" className="mb-14">
      {/*
        Not "in your catalogue", which it never was.

        `GET /podcasts` returns every show anyone has added — it is one shared
        catalogue, not a per-listener one. Calling it *yours* meant that opening
        a search result, which has to read the feed to have anything to show
        you, made a show appear under a heading claiming you had collected it.
        Your shows live in Library, behind Follow, and always did.

        The recommended heading is the one case where a possessive is true, and
        it comes with a note saying what it is based on — a personalised order
        that does not admit to being personalised just reads as an arbitrary one.
      */}
      <SectionHeader
        id="catalogue-heading"
        label={personalized ? t.t('home.recommended') : t.t('home.catalogue')}
        note={personalized ? t.t('home.recommendedNote') : t.t('home.catalogueNote')}
      />

      <ul className="grid list-none grid-cols-2 gap-x-5 gap-y-7 p-0 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {shows.map((podcast, index) => (
          <li key={podcast.id}>
            {/* The first row is above the fold on every breakpoint, so it
                loads eagerly; the rest stay lazy. */}
            <PodcastTile podcast={podcast} priority={index < 5} />
          </li>
        ))}
      </ul>
    </section>
  );
}
