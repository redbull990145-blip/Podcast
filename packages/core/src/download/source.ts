/**
 * Choosing between the file on disk and the publisher's URL.
 *
 * This is the whole of "offline playback". The player has no idea downloads
 * exist — it is handed an episode with an `audioUrl` and plays it — so making a
 * saved episode play from disk is a matter of swapping one string for another
 * before the player ever sees it.
 *
 * Keeping it that way is the point. The alternative, a player that knows about
 * downloads, means every queue advance, every resume and every sleep-timer path
 * has to remember to ask — and the one that forgets streams a file the listener
 * already paid to store, on a train, silently.
 */

import type { PlayableEpisode } from '../player/machine.ts';
import type { DownloadIndex, DownloadRecord } from './downloads.ts';

/**
 * Point an episode at its local copy, if there is one.
 *
 * Returns the episode untouched — the same object — when there is nothing
 * saved, so callers can apply this unconditionally without churning identity
 * for the common case.
 */
export function preferLocal(episode: PlayableEpisode, index: DownloadIndex): PlayableEpisode {
  const record = index[episode.id];
  if (!record || record.status !== 'complete' || !record.fileUri) {
    if (!episode.remoteAudioUrl || episode.audioUrl === episode.remoteAudioUrl) return episode;
    return { ...episode, audioUrl: episode.remoteAudioUrl, artworkUrl: episode.remoteArtworkUrl ?? null };
  }
  if (episode.audioUrl === record.fileUri && episode.artworkUrl === (record.artworkUri ?? episode.remoteArtworkUrl ?? episode.artworkUrl)) return episode;

  return {
    ...episode,
    remoteAudioUrl: episode.remoteAudioUrl ?? episode.audioUrl,
    remoteArtworkUrl: episode.remoteArtworkUrl ?? episode.artworkUrl,
    audioUrl: record.fileUri,
    // Artwork too: a Downloads screen full of grey squares is what happens
    // when the audio was saved and the cover was left behind on a CDN.
    artworkUrl: record.artworkUri ?? episode.artworkUrl,
  };
}

/** The same swap across a whole queue, so what plays next is local too. */
export function preferLocalAll(
  episodes: PlayableEpisode[],
  index: DownloadIndex,
): PlayableEpisode[] {
  return episodes.map((episode) => preferLocal(episode, index));
}

/**
 * An episode reconstructed from what was saved about it.
 *
 * The Downloads screen needs this: it renders and plays with no network, so it
 * cannot fetch the episode it is about to play. The record was written with
 * exactly this in mind, which is why it carries the show's title and the
 * artwork rather than just ids.
 *
 * Falls back to the publisher's URL when the file is gone — Android is allowed
 * to reclaim an app's storage, and a row that streams is a better answer than
 * a row that fails.
 */
export function playableFromDownload(record: DownloadRecord): PlayableEpisode {
  return {
    id: record.episodeId,
    podcastId: record.podcastId,
    title: record.title,
    audioUrl: record.fileUri ?? record.audioUrl,
    remoteAudioUrl: record.audioUrl,
    remoteArtworkUrl: record.artworkUrl,
    durationSec: record.durationSec,
    artworkUrl: record.artworkUri ?? record.artworkUrl,
    podcastTitle: record.podcastTitle,
    accentColor: record.accentColor,
  };
}
