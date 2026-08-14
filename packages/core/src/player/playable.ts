import type { Episode, QueueEntry } from '@cue/types';
import type { PlayableEpisode } from './machine.ts';

/**
 * Turning stored shapes into something the player can play.
 *
 * The player needs the show's title and artwork alongside the episode's own,
 * because what it renders is "this episode, of this show" — but an `Episode`
 * on its own carries neither. Every call site was otherwise going to assemble
 * that by hand, and the one that forgot the artwork fallback would render a
 * blank cover only for episodes that happen to lack their own.
 */

export function playableFromQueueEntry(entry: QueueEntry): PlayableEpisode {
  return {
    id: entry.episode.id,
    podcastId: entry.episode.podcastId,
    title: entry.episode.title,
    audioUrl: entry.episode.audioUrl,
    durationSec: entry.episode.durationSec,
    // Episode art where the publisher provided it, the show's cover otherwise.
    artworkUrl: entry.episode.artworkUrl ?? entry.podcastArtworkUrl,
    podcastTitle: entry.podcastTitle,
    accentColor: entry.accentColor,
  };
}

export function playableFromEpisode(
  episode: Episode,
  podcast: { title: string; artworkUrl: string | null; accentColor?: string | null },
): PlayableEpisode {
  return {
    id: episode.id,
    podcastId: episode.podcastId,
    title: episode.title,
    audioUrl: episode.audioUrl,
    durationSec: episode.durationSec,
    artworkUrl: episode.artworkUrl ?? podcast.artworkUrl,
    podcastTitle: podcast.title,
    accentColor: podcast.accentColor ?? null,
  };
}
