import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { ChevronLeft, Rss } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { playbackState } from "@/lib/db/schema";
import { getEpisodeWithPodcast } from "@/lib/podcasts/ingest";
import { PageShell, SectionLabel } from "@/components/ui/page";
import { EpisodePlayButton } from "@/components/episodes/episode-play-button";
import { ChaptersSection } from "@/components/chapters/chapters-section";
import { AiPanel } from "@/components/ai/ai-panel";
import { ReadAlongCard } from "@/components/episodes/read-along-card";
import { formatDurationLong, formatRelativeDate, stripHtml } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const episode = await getEpisodeWithPodcast(id);
  return { title: episode?.title ?? "Episode" };
}

export default async function EpisodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const episode = await getEpisodeWithPodcast(id);
  if (!episode) notFound();

  const { podcast } = episode;

  const progress = await db.query.playbackState.findFirst({
    where: and(eq(playbackState.userId, user.id), eq(playbackState.episodeId, id)),
  });

  const artwork = episode.imageUrl ?? podcast.artworkUrl;
  const description = stripHtml(episode.description);

  const playable = {
    id: episode.id,
    title: episode.title,
    enclosureUrl: episode.enclosureUrl,
    durationSeconds: episode.durationSeconds,
    artworkUrl: artwork,
    podcastId: podcast.id,
    podcastTitle: podcast.title,
    categories: podcast.categories,
  };

  // Reads as one line of provenance rather than three separate facts.
  const meta = [
    episode.episodeNumber ? `Episode ${episode.episodeNumber}` : null,
    formatRelativeDate(episode.publishedAt),
    episode.durationSeconds ? formatDurationLong(episode.durationSeconds) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PageShell>
      <Link
        href={`/podcast/${podcast.id}`}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-subtle transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" strokeWidth={2} />
        {podcast.title}
      </Link>

      <header className="mt-5 flex flex-col gap-5 sm:flex-row sm:gap-6">
        {artwork ? (
          <Image
            src={artwork}
            alt=""
            width={336}
            height={336}
            sizes="(max-width: 640px) 128px, 168px"
            priority
            className="size-32 shrink-0 rounded-[18px] object-cover shadow-[0_16px_40px_rgb(34_32_29_/_0.2)] sm:size-42"
          />
        ) : (
          <span className="grid size-32 shrink-0 place-items-center rounded-[18px] bg-accent-subtle text-accent sm:size-42">
            <Rss className="size-8" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          {meta && <SectionLabel>{meta}</SectionLabel>}

          <h1 className="mt-2.5 text-pretty text-[26px] font-semibold leading-[1.18] -tracking-[0.03em] sm:text-[32px]">
            {episode.title}
          </h1>

          <div className="mt-4.5">
            <EpisodePlayButton
              episode={playable}
              resumeAt={progress && !progress.played ? Number(progress.positionSeconds) : 0}
              played={progress?.played ?? false}
            />
          </div>
        </div>
      </header>

      {/*
        Reading matter on the left, tools on the right. The sidebar is sticky
        because the left column is unbounded — a long transcript-backed chapter
        list runs for screens — and the point of the tools is to be reachable
        from wherever you are in it.
      */}
      <div className="mt-9 grid items-start gap-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {description && (
            <div className="whitespace-pre-line text-[15.5px] leading-[1.8] text-ink-3">
              {description}
            </div>
          )}

          <ChaptersSection episodeId={episode.id} />
        </div>

        <div className="flex min-w-0 flex-col gap-3.5 lg:sticky lg:top-[92px]">
          <AiPanel episodeId={episode.id} episodeTitle={episode.title} />
          <ReadAlongCard episode={playable} />
        </div>
      </div>
    </PageShell>
  );
}
