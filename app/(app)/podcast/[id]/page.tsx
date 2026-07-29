import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { eq, inArray } from "drizzle-orm";
import { Rss } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { playbackState, podcasts } from "@/lib/db/schema";
import { listEpisodes } from "@/lib/podcasts/ingest";
import { PageShell } from "@/components/ui/page";
import { EpisodeRow } from "@/components/episodes/episode-row";
import { SubscribeButton } from "@/components/podcasts/subscribe-button";
import { stripHtml } from "@/lib/utils";

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

  const episodes = await listEpisodes(podcast.id, 50);

  const subscription = await db.query.subscriptions.findFirst({
    where: (s, { and }) => and(eq(s.userId, user.id), eq(s.podcastId, podcast.id)),
  });

  // One query for every episode's progress, rather than one per row.
  const progressRows =
    episodes.length > 0
      ? await db
          .select()
          .from(playbackState)
          .where(
            inArray(
              playbackState.episodeId,
              episodes.map((e) => e.id),
            ),
          )
      : [];

  const progressByEpisode = new Map(
    progressRows
      .filter((r) => r.userId === user.id)
      .map((r) => [
        r.episodeId,
        { positionSeconds: Number(r.positionSeconds), played: r.played },
      ]),
  );

  const description = stripHtml(podcast.description);

  return (
    <PageShell>
      <header className="flex flex-col gap-5 sm:flex-row sm:gap-6">
        {podcast.artworkUrl ? (
          <Image
            src={podcast.artworkUrl}
            alt=""
            width={176}
            height={176}
            unoptimized
            priority
            className="size-32 shrink-0 rounded-2xl object-cover shadow-[var(--shadow-soft)] sm:size-44"
          />
        ) : (
          <span className="grid size-32 shrink-0 place-items-center rounded-2xl bg-accent-subtle text-accent sm:size-44">
            <Rss className="size-10" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            {podcast.title}
          </h1>
          {podcast.author && (
            <p className="mt-1 text-sm text-muted-foreground">{podcast.author}</p>
          )}

          {podcast.categories.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {podcast.categories.slice(0, 5).map((category) => (
                <li
                  key={category}
                  className="rounded-full bg-surface-raised px-2.5 py-0.5 text-xs text-muted-foreground"
                >
                  {category}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4">
            <SubscribeButton
              podcastId={podcast.id}
              feedUrl={podcast.feedUrl}
              initiallySubscribed={Boolean(subscription)}
            />
          </div>
        </div>
      </header>

      {description && (
        <p className="mt-6 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}

      <section className="mt-8">
        <div className="flex items-baseline justify-between border-b border-border pb-3">
          <h2 className="font-semibold tracking-tight">Episodes</h2>
          <span className="text-xs text-subtle-foreground">
            {episodes.length} shown
          </span>
        </div>

        {episodes.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No episodes found in this feed yet.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border/60">
            {episodes.map((episode) => (
              <EpisodeRow
                key={episode.id}
                episode={episode}
                podcast={{
                  id: podcast.id,
                  title: podcast.title,
                  artworkUrl: podcast.artworkUrl,
                  categories: podcast.categories,
                }}
                progress={progressByEpisode.get(episode.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
