"use client";

import { CheckCircle2, Loader2, Pause, Play } from "lucide-react";
import { usePlayer, type PlayableEpisode } from "@/lib/player/store";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/utils";

/** Primary play control on the episode page, with resume state made explicit. */
export function EpisodePlayButton({
  episode,
  resumeAt,
  played,
}: {
  episode: PlayableEpisode;
  resumeAt: number;
  played: boolean;
}) {
  const currentId = usePlayer((s) => s.episode?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isBuffering = usePlayer((s) => s.isBuffering);
  const load = usePlayer((s) => s.load);
  const toggle = usePlayer((s) => s.toggle);

  const isCurrent = currentId === episode.id;
  const canResume = resumeAt > 30 && !played;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="lg"
        onClick={() => (isCurrent ? toggle() : load(episode, canResume ? resumeAt : 0))}
      >
        {isCurrent && isBuffering ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isCurrent && isPlaying ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="size-4 fill-current" />
        )}
        {isCurrent && isPlaying
          ? "Pause"
          : canResume
            ? `Resume at ${formatDuration(resumeAt)}`
            : "Play"}
      </Button>

      {canResume && (
        <Button size="lg" variant="secondary" onClick={() => load(episode, 0)}>
          Start over
        </Button>
      )}

      {played && (
        <span className="inline-flex items-center gap-1.5 text-sm text-success">
          <CheckCircle2 className="size-4" />
          Played
        </span>
      )}
    </div>
  );
}
