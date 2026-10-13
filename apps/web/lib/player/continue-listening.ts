import type { PlayableEpisode } from '@cue/core';
import type { ContinueEntry, Episode } from '@cue/types';

/** Only the episode fields the resume panel renders or plays. */
export type ResumeEntry = {
  episode: Pick<Episode, 'id' | 'podcastId' | 'title' | 'audioUrl' | 'artworkUrl' | 'durationSec'>;
  podcastTitle: string;
  podcastArtworkUrl: string | null;
  accentColor: string | null;
  positionSec: number;
  durationSec: number | null;
};

/** The local player owns the lead; saved history only supplies the other cards. */
export function continueListeningEntries(
  items: readonly ContinueEntry[],
  current: PlayableEpisode | null,
  durationSec: number | null,
): { lead: ResumeEntry | undefined; rest: ContinueEntry[] } {
  if (!current) return { lead: items[0], rest: items.slice(1, 4) };

  const saved = items.find((item) => item.episode.id === current.id);
  return {
    lead: {
      episode: {
        id: current.id,
        podcastId: current.podcastId,
        title: current.title,
        audioUrl: current.audioUrl,
        artworkUrl: current.artworkUrl,
        durationSec: current.durationSec,
      },
      podcastTitle: current.podcastTitle,
      podcastArtworkUrl: saved?.podcastArtworkUrl ?? current.artworkUrl,
      accentColor: current.accentColor ?? saved?.accentColor ?? null,
      positionSec: saved?.positionSec ?? 0,
      durationSec: durationSec ?? current.durationSec,
    },
    rest: items.filter((item) => item.episode.id !== current.id).slice(0, 3),
  };
}
