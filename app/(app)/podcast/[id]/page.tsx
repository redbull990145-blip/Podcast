import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, inArray } from "drizzle-orm";
import { Rss } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { playbackState, podcasts } from "@/lib/db/schema";
import { listEpisodes } from "@/lib/podcasts/ingest";
import { PageShell } from "@/components/ui/page";
import { EpisodeList } from "@/components/episodes/episode-list";
import { SubscribeButton } from "@/components/podcasts/subscribe-button";
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
  const podcast = await db.query.podcasts.findFirst({ where: eq(podcasts.id, id) });
  if (!podcast) notFound();

  // Independent of each other, so they go out together rather than paying three
  // round-trips to Supabase in series.
  const [episodes, subscription] = await Promise.all([
    listEpisodes(podcast.id, 50),
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
          "px-5 pb-8 pt-9 sm:px-10 sm:pt-11",
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
        <div className="mx-auto flex max-w-[1000px] flex-col gap-5 sm:flex-row sm:items-end sm:gap-6">
          {podcast.artworkUrl ? (
            <Image
              src={podcast.artworkUrl}
              alt=""
              width={360}
              height={360}
              sizes="(max-width: 640px) 128px, 180px"
              priority
              className="size-32 shrink-0 rounded-[18px] object-cover shadow-[0_20px_48px_rgb(20_24_20_/_0.4)] sm:size-45"
            />
          ) : (
            <span className="grid size-32 shrink-0 place-items-center rounded-[18px] bg-white/10 text-white/70 sm:size-45">
              <Rss className="size-10" />
            </span>
          )}

          <div className="min-w-0 flex-1 pb-1.5">
            {podcast.categories.length > 0 && (
              <p className="truncate text-[11.5px] font-semibold uppercase tracking-[0.12em] text-white/60">
                {podcast.categories.slice(0, 2).join(" · ")}
              </p>
            )}

            <h1 className="mt-2.5 text-pretty text-[28px] font-semibold -tracking-[0.03em] text-[#f7f5f0] sm:text-[36px]">
              {podcast.title}
            </h1>

            {credits && (
              <p className="mt-2 text-[14.5px] text-white/70">{credits}</p>
            )}

            <div className="mt-4.5">
              <SubscribeButton
                podcastId={podcast.id}
                feedUrl={podcast.feedUrl}
                initiallySubscribed={Boolean(subscription)}
                onDark
              />
            </div>
          </div>
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
            <span className="text-xs text-subtle-2">{episodes.length} shown</span>
          </div>

          {episodes.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">
              No episodes found in this feed yet.
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
            />
          )}
        </section>
      </PageShell>
    </>
  );
}
