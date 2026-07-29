import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { Rss } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { playbackState } from "@/lib/db/schema";
import { getEpisodeWithPodcast } from "@/lib/podcasts/ingest";
import { PageShell } from "@/components/ui/page";
import { EpisodePlayButton } from "@/components/episodes/episode-play-button";
import { ChaptersSection } from "@/components/chapters/chapters-section";
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

  return (
    <PageShell className="max-w-3xl">
      <Link
        href={`/podcast/${podcast.id}`}
        className="text-xs font-medium text-accent hover:underline"
      >
        ← {podcast.title}
      </Link>

      <header className="mt-4 flex gap-4 sm:gap-5">
        {artwork ? (
          <Image
            src={artwork}
            alt=""
            width={128}
            height={128}
            unoptimized
            priority
            className="size-20 shrink-0 rounded-xl object-cover shadow-[var(--shadow-soft)] sm:size-32"
          />
        ) : (
          <span className="grid size-20 shrink-0 place-items-center rounded-xl bg-accent-subtle text-accent sm:size-32">
            <Rss className="size-7" />
          </span>
        )}

        <div className="min-w-0">
          <h1 className="text-balance text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
            {episode.title}
          </h1>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {formatRelativeDate(episode.publishedAt)}
            {episode.durationSeconds ? (
              <>
                <span className="mx-1.5" aria-hidden>
                  ·
                </span>
                {formatDurationLong(episode.durationSeconds)}
              </>
            ) : null}
          </p>
        </div>
      </header>

      <div className="mt-6">
        <EpisodePlayButton
          episode={{
            id: episode.id,
            title: episode.title,
            enclosureUrl: episode.enclosureUrl,
            durationSeconds: episode.durationSeconds,
            artworkUrl: artwork,
            podcastId: podcast.id,
            podcastTitle: podcast.title,
            categories: podcast.categories,
          }}
          resumeAt={
            progress && !progress.played ? Number(progress.positionSeconds) : 0
          }
          played={progress?.played ?? false}
        />
      </div>

      <ChaptersSection episodeId={episode.id} />

      {description && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
            Show notes
          </h2>
          <div className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {description}
          </div>
        </section>
      )}

      {/* Phase 3 adds AI show notes, chapters and transcript Q&A here. */}
    </PageShell>
  );
}
