/**
 * Database rows → wire shapes.
 *
 * The one boundary where `Date` becomes an ISO string. Doing it here rather
 * than in each route means no endpoint can accidentally ship a
 * `"2026-08-13T09:41:00.000Z"` from one query and a raw timestamp from
 * another, and the client's types stay true after `JSON.parse`.
 */

import type { EpisodeRow, PodcastRow } from '@cue/db';
import type { Episode, EpisodeWithPodcast, Podcast } from '@cue/types';

export function serializePodcast(row: PodcastRow, categories: string[] = []): Podcast {
  return {
    id: row.id,
    feedUrl: row.feedUrl,
    title: row.title,
    author: row.author,
    description: row.description,
    artworkUrl: row.artworkUrl,
    websiteUrl: row.websiteUrl,
    language: row.language,
    categories,
    explicit: row.explicit,
    episodeCount: row.episodeCount,
    lastPublishedAt: row.lastPublishedAt?.toISOString() ?? null,
    accentColor: row.accentColor,
    source: row.source,
  };
}

export function serializeEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id,
    podcastId: row.podcastId,
    guid: row.guid,
    title: row.title,
    description: row.description,
    descriptionHtml: row.descriptionHtml,
    audioUrl: row.audioUrl,
    durationSec: row.durationSec,
    publishedAt: row.publishedAt.toISOString(),
    artworkUrl: row.artworkUrl,
    // Null until someone plays it; the client falls back to the show's colour.
    accentColor: row.accentColor,
    episodeNumber: row.episodeNumber,
    seasonNumber: row.seasonNumber,
    explicit: row.explicit,
    transcriptUrl: row.transcriptUrl,
  };
}

/**
 * An episode carrying enough of its show to render a row on its own — which is
 * what stops a "new releases" list from firing one query per row to find out
 * which podcast each episode belongs to.
 */
export function serializeEpisodeWithPodcast(
  row: EpisodeRow,
  podcast: Pick<PodcastRow, 'id' | 'title' | 'artworkUrl' | 'author'>,
): EpisodeWithPodcast {
  return {
    ...serializeEpisode(row),
    podcast: {
      id: podcast.id,
      title: podcast.title,
      // Episode art is optional; the show's cover is the fallback the UI needs.
      artworkUrl: podcast.artworkUrl,
      author: podcast.author,
    },
  };
}
