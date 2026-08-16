/**
 * The schema, assembled.
 *
 * Playback progress and queues arrive with the audio engine — they are the
 * player's state, and defining them before the player exists would be guessing
 * at a shape the engine has not settled yet.
 */

export {
  categories,
  episodes,
  podcastCategories,
  podcasts,
} from './catalog.ts';

export type {
  CategoryRow,
  EpisodeRow,
  NewEpisodeRow,
  NewPodcastRow,
  PodcastRow,
} from './catalog.ts';

export { accounts, sessions, users, verifications } from './auth.ts';
export type { SessionRow, UserRow } from './auth.ts';

export { profiles, subscriptions } from './library.ts';
export type { ProfileRow, SubscriptionRow } from './library.ts';

export { playbackProgress, queueItems } from './playback.ts';
export type { PlaybackProgressRow, QueueItemRow } from './playback.ts';

export { playlistItems, playlists } from './playlist.ts';
export type { PlaylistItemRow, PlaylistRow } from './playlist.ts';

export { transcriptionJobs, transcripts } from './transcript.ts';
export type {
  NewTranscriptionJobRow,
  NewTranscriptRow,
  StoredSegment,
  TranscriptionJobRow,
  TranscriptRow,
} from './transcript.ts';

export { aiUsage, episodeAi, userApiKeys } from './ai.ts';
export type {
  AiUsageRow,
  EpisodeAiRow,
  NewEpisodeAiRow,
  UserApiKeyRow,
} from './ai.ts';
