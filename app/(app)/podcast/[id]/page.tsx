import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, inArray } from "drizzle-orm";
import { Rss } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { playbackState, podcasts } from "@/lib/db/schema";
import { countEpisodes, ingestFeed, listEpisodes } from "@/lib/podcasts/ingest";
import { PageShell } from "@/components/ui/page";
import { EpisodeList, PAGE_SIZE } from "@/components/episodes/episode-list";
import { SubscribeButton } from "@/components/podcasts/subscribe-button";
import { PlayLatestButton } from "@/components/podcasts/play-latest-button";
import { stripHtml } from "@/lib/utils";

/* Locale pinned, as everywhere else that formats a date — see lib/utils.ts. */
const FOLLOWED_SINCE = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const podcast = await db.query.podcasts.findFirst({ where: eq(podcasts.id, id) });
  return { title: podcast?.title ?? "Podcast" };
}

export default async function PodcastPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const stored = await db.query.podcasts.findFirst({ where: eq(podcasts.id, id) });
  if (!stored) notFound();

  /*
   * Bring the show up to date before rendering it.
   *
   * This was missing, and it was the reason shows appeared with no episodes at
   * all. A podcast can enter the catalogue as a stub — `ensureCatalogPodcast`
   * writes what a search result gave us without fetching the feed, on the
   * reasoning that the first real visit would ingest it properly. Nothing ever
   * did. Opening such a show ran one query against an empty `episodes` table
   * and rendered "0 shown", permanently, for feeds with hundreds of episodes.
   *
   * `ingestFeed` is safe to call on every visit: it returns the cached row
   * without touching the network while the last fetch is under an hour old, so
   * the common case is two cheap queries and the stale case is the refresh this
   * page should always have been doing.
   */
  const ingested = await ingestFeed(stored.feedUrl);
  const podcast = ingested.status === "ok" ? ingested.podcast : stored;

  // Independent of each other, so they go out together rather than paying three
  // round-trips to Supabase in series.
  const [episodes, episodeTotal, subscription] = await Promise.all([
    listEpisodes(podcast.id, PAGE_SIZE),
    countEpisodes(podcast.id),
    db.query.subscriptions.findFirst({
      where: (s, { and }) => and(eq(s.userId, user.id), eq(s.podcastId, podcast.id)),
    }),
  ]);

  // One query for every episode's progress, rather than one per row. Filtering
  // by user in SQL rather than in JS means the database returns this user's rows
  // only, instead of every listener's row for these episodes.
  const progressRows =
    episodes.length > 0
      ? await db
          .select({
            episodeId: playbackState.episodeId,
            positionSeconds: playbackState.positionSeconds,
            played: playbackState.played,
          })
          .from(playbackState)
          .where(
            and(
              eq(playbackState.userId, user.id),
              inArray(
                playbackState.episodeId,
                episodes.map((e) => e.id),
              ),
            ),
          )
      : [];

  const progressByEpisode = new Map(
    progressRows.map((r) => [
      r.episodeId,
      { positionSeconds: Number(r.positionSeconds), played: r.played },
    ]),
  );

  const description = stripHtml(podcast.description);

  const following = subscription
    ? `Following since ${FOLLOWED_SINCE.format(subscription.subscribedAt)}`
    : null;

  const credits = [podcast.author, following].filter(Boolean).join(" · ");

  // `listEpisodes` returns newest first, so this is what "Play latest" plays.
  const latest = episodes[0];

  return (
    <>
      {/*
        A tinted band behind the title, bleeding to both edges and fading into
        the page beneath it.

        The tint is the accent rather than anything sampled from the cover.
        Sampling would mean either shipping the image to the server to analyse
        or leaving a grey box until the client had read the pixels — and a band
        that changes colour after paint is worse than one that never claimed to
        match. The cover supplies the colour by sitting on top of it.
      */}
      <div
        className={[
          "relative bg-[radial-gradient(90%_140%_at_8%_0%,#3c5445_0%,#33463a_48%,var(--background)_100%)]",
          "px-5 pb-8 sm:px-10",
          /*
           * On a phone the band runs to the very top of the screen: it pulls
           * back the shell's whole top padding and re-spends it as its own,
           * so the content still starts exactly where every other page's does
           * while the colour reaches up behind the floating tab bar.
           *
           * That is the reason to bother. The bar is glass, and glass with
           * nothing behind it is just a tinted strip — this is the one screen
           * in the app with a saturated field for it to pick up, and stopping
           * the band below the bar would leave it sitting on flat background
           * with a hard colour edge starting an inch underneath.
           */
          "-mt-[calc(env(safe-area-inset-top)+5.625rem)]",
          "pt-[calc(env(safe-area-inset-top)+5.625rem)]",
          "lg:mt-0 lg:pt-11",
          /*
           * The radial alone still meets the page in a straight line along the
           * bottom, because at that distance from its origin it has not run out
           * of colour yet. A short vertical fade over the last few rem takes it
           * the rest of the way, so the band dissolves into the page instead of
           * stopping at an edge.
           */
          "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-20",
          "after:bg-[linear-gradient(to_bottom,transparent,var(--background))]",
        ].join(" ")}
      >
        {/*
          Cover beside the title at every width now, rather than stacked below
          `sm`. A 128px square on its own line was spending a quarter of a phone
          viewport to say what a 112px one beside the title says just as well —
          and stacking put the follow button three blocks down from the top of
          the screen, which is where the fold is.
        */}
        <div className="mx-auto flex max-w-[1000px] items-end gap-4 sm:gap-6">
          {podcast.artworkUrl ? (
            <Image
              src={podcast.artworkUrl}
              alt=""
              width={360}
              height={360}
              sizes="(max-width: 640px) 112px, 180px"
              priority
              className="size-28 shrink-0 rounded-[16px] object-cover shadow-[0_16px_36px_rgb(20_24_20_/_0.45)] sm:size-45 sm:rounded-[18px]"
            />
          ) : (
            <span className="grid size-28 shrink-0 place-items-center rounded-[16px] bg-white/10 text-white/70 sm:size-45 sm:rounded-[18px]">
              <Rss className="size-10" />
            </span>
          )}

          <div className="min-w-0 flex-1 pb-1">
            {podcast.categories.length > 0 && (
              <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/60 sm:text-[11.5px]">
                {podcast.categories.slice(0, 2).join(" · ")}
              </p>
            )}

            <h1 className="mt-1.5 text-pretty text-[24px] font-semibold leading-[1.15] -tracking-[0.03em] text-[#f7f5f0] sm:mt-2.5 sm:text-[36px]">
              {podcast.title}
            </h1>

            {credits && (
              <p className="mt-1.5 truncate text-[12.5px] text-white/70 sm:mt-2 sm:whitespace-normal sm:text-[14.5px]">
                {credits}
              </p>
            )}

            {/* Below `sm` the actions move out of this column and onto their own
                full-width row — see below. There is not room beside a 112px
                cover for a filled button and an outlined one. */}
            <div className="mt-4.5 hidden sm:block">
              <SubscribeButton
                podcastId={podcast.id}
                feedUrl={podcast.feedUrl}
                initiallySubscribed={Boolean(subscription)}
                onDark
              />
            </div>
          </div>
        </div>

        <div className="mx-auto mt-4 flex max-w-[1000px] items-center gap-2.5 sm:hidden">
          {latest && (
            <PlayLatestButton
              episode={{
                id: latest.id,
                title: latest.title,
                enclosureUrl: latest.enclosureUrl,
                durationSeconds: latest.durationSeconds,
                artworkUrl: latest.imageUrl ?? podcast.artworkUrl,
                podcastId: podcast.id,
                podcastTitle: podcast.title,
                categories: podcast.categories,
              }}
            />
          )}
          {/* Matched to `PlayLatestButton`'s 44px beside it — the shared
              `Button` is 40px, which reads as a misprint next to it. */}
          <SubscribeButton
            podcastId={podcast.id}
            feedUrl={podcast.feedUrl}
            initiallySubscribed={Boolean(subscription)}
            onDark
            className="h-11 shrink-0 px-4.5 text-[14px]"
          />
        </div>
      </div>

      <PageShell className="pt-6">
        {description && (
          <p className="max-w-[74ch] text-pretty whitespace-pre-line text-[15px] leading-[1.75] text-ink-3">
            {description}
          </p>
        )}

        <section className="mt-7">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3.5">
            <h2 className="text-[17px] font-semibold -tracking-[0.02em]">Episodes</h2>
            {/* The show's real total, not the size of the first page. "50
                shown" on a 535-episode show read as the show only having 50. */}
            <span className="text-xs text-subtle-2 tabular-nums">
              {episodeTotal === 1 ? "1 episode" : `${episodeTotal} episodes`}
            </span>
          </div>

          {episodeTotal === 0 ? (
            /*
              Named rather than left as "no episodes found", because the two
              ways to get here need different things from the reader. A feed
              with items but no audio is a blog's feed pasted in place of a
              podcast's, and no amount of waiting will fix it.
            */
            <p className="py-10 text-center text-sm text-muted">
              {ingested.status === "ok" && (ingested.feed?.totalItems ?? 0) > 0
                ? "This feed has articles rather than audio, so there's nothing to play. It's most likely the site's blog feed rather than its podcast feed."
                : "No episodes found in this feed yet."}
            </p>
          ) : (
            <EpisodeList
              items={episodes.map((episode) => ({
                // Descriptions are RSS HTML. Stripping it here means it happens
                // once on the server instead of fifty times in the browser, and
                // the markup never ships to the client at all.
                episode: { ...episode, description: stripHtml(episode.description) },
                progress: progressByEpisode.get(episode.id),
              }))}
              podcast={{
                id: podcast.id,
                title: podcast.title,
                artworkUrl: podcast.artworkUrl,
                categories: podcast.categories,
              }}
              total={episodeTotal}
            />
          )}
        </section>
      </PageShell>
    </>
  );
}
