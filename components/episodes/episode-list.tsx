"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { usePrefs } from "@/lib/prefs/store";
import { matchesFilter, type EpisodeFilter } from "@/lib/episodes/filters";
import { Button } from "@/components/ui/button";
import { EpisodeRow, type EpisodeProgress, type EpisodeRowData } from "./episode-row";
import { cn } from "@/lib/utils";

/**
 * Episodes per page, first and after.
 *
 * The show page renders this many on the server and each "show more" adds
 * another. Large enough that most shows need one press or none, small enough
 * that the initial HTML for a thousand-episode feed is not the largest document
 * the app ships.
 */
export const PAGE_SIZE = 100;

const FILTERS: { value: EpisodeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unplayed", label: "Unplayed" },
  { value: "in_progress", label: "In progress" },
  { value: "played", label: "Played" },
];

export type EpisodeWithProgress = {
  episode: EpisodeRowData;
  progress?: EpisodeProgress;
};

export function EpisodeList({
  items,
  podcast,
  total,
}: {
  /** The first page, rendered on the server so the show is usable immediately. */
  items: EpisodeWithProgress[];
  podcast: { id: string; title: string; artworkUrl: string | null; categories: string[] };
  /** Episodes the show has in total, which is usually more than `items`. */
  total?: number;
}) {
  const powerMode = usePrefs((s) => s.powerMode);
  const filter = usePrefs((s) => s.episodeFilter);
  const setFilter = usePrefs((s) => s.setEpisodeFilter);

  /**
   * Pages fetched since the first.
   *
   * Reset whenever the server sends a different first page — navigating to
   * another show reuses this component, and without the reset the previous
   * show's back catalogue would stay appended below the new one's.
   */
  const [extra, setExtra] = useState<EpisodeWithProgress[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setExtra([]);
    setLoadError(null);
  }, [items, podcast.id]);

  const loaded = useMemo(() => [...items, ...extra], [items, extra]);
  const more = Math.max(0, (total ?? loaded.length) - loaded.length);

  async function loadMore() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/podcasts/${podcast.id}/episodes?offset=${loaded.length}&limit=${PAGE_SIZE}`,
      );
      if (!res.ok) throw new Error("failed");
      const body = (await res.json()) as { episodes: EpisodeWithProgress[] };
      setExtra((current) => [...current, ...body.episodes]);
    } catch {
      setLoadError("Couldn't load more episodes. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const visible = useMemo(
    () => (powerMode ? loaded.filter((i) => matchesFilter(filter, i.progress)) : loaded),
    [loaded, filter, powerMode],
  );

  return (
    <>
      {powerMode && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter episodes">
          {FILTERS.map((option) => {
            const count = items.filter((i) => matchesFilter(option.value, i.progress)).length;
            const active = filter === option.value;
            return (
              <button
                key={option.value}
                onClick={() => setFilter(option.value)}
                aria-pressed={active}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "bg-surface-raised text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {option.label}
                <span className="ml-1.5 tabular-nums opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No episodes match this filter.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border/60">
          {visible.map(({ episode, progress }) => (
            <EpisodeRow
              key={episode.id}
              episode={episode}
              podcast={podcast}
              progress={progress}
            />
          ))}
        </ul>
      )}

      {/*
        The back catalogue, on request.

        A show with hundreds of episodes used to end at whatever the first page
        held, with nothing to say there were more — so a thousand-episode feed
        looked like a fifty-episode one. The count is named rather than left as
        "more", because the number is the thing that was missing.
      */}
      {more > 0 && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <Button variant="secondary" onClick={loadMore} disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            {loading
              ? "Loading…"
              : `Show ${Math.min(more, PAGE_SIZE)} more of ${more}`}
          </Button>
          {loadError && (
            <p role="alert" className="text-xs text-danger">
              {loadError}
            </p>
          )}
        </div>
      )}
    </>
  );
}
