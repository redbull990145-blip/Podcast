"use client";

import { useMemo } from "react";
import { usePrefs } from "@/lib/prefs/store";
import { matchesFilter, type EpisodeFilter } from "@/lib/episodes/filters";
import { EpisodeRow, type EpisodeProgress, type EpisodeRowData } from "./episode-row";
import { cn } from "@/lib/utils";

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
}: {
  items: EpisodeWithProgress[];
  podcast: { id: string; title: string; artworkUrl: string | null; categories: string[] };
}) {
  const powerMode = usePrefs((s) => s.powerMode);
  const filter = usePrefs((s) => s.episodeFilter);
  const setFilter = usePrefs((s) => s.setEpisodeFilter);

  const visible = useMemo(
    () => (powerMode ? items.filter((i) => matchesFilter(filter, i.progress)) : items),
    [items, filter, powerMode],
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
    </>
  );
}
