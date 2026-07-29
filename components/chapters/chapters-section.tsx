"use client";

import { useQuery } from "@tanstack/react-query";
import type { Chapter } from "@/lib/db/schema";
import { ChapterList } from "./chapter-list";

/**
 * Loads chapters for an episode after the page renders.
 *
 * Resolving them can involve fetching a document from the publisher, so it is
 * kept off the server render — a slow chapters host must not delay the episode
 * page or its play button.
 */
export function ChaptersSection({ episodeId }: { episodeId: string }) {
  const { data } = useQuery({
    queryKey: ["chapters", episodeId],
    queryFn: async () => {
      const res = await fetch(`/api/episodes/${episodeId}/chapters`);
      if (!res.ok) throw new Error("Failed to load chapters");
      return (await res.json()) as { chapters: Chapter[] | null; source: string | null };
    },
    staleTime: 60 * 60 * 1000,
  });

  if (!data?.chapters?.length) return null;

  return (
    <ChapterList
      chapters={data.chapters}
      source={data.source}
      episodeId={episodeId}
    />
  );
}
