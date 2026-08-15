/**
 * What has been saved to this device, and what is on its way.
 *
 * Downloads are deliberately **not** a server concern. Nothing here is synced:
 * a file on a phone is not a file on a laptop, and a table of "episodes user X
 * downloaded" would describe storage the server cannot see, cannot verify, and
 * cannot free. Each device keeps its own index and that index *is* the truth.
 *
 * That has a consequence worth stating plainly: the index has to carry enough
 * of each episode to render it — title, show, duration, artwork — because the
 * entire point is that it works with the network gone, and an id alone is
 * useless when there is nobody to ask about it.
 *
 * Everything in this file is a pure function over an index. The actual writing
 * of bytes lives on the platform side, where it can be neither tested nor
 * trusted; what *can* go wrong in interesting ways — a download interrupted
 * mid-flight, two taps on the same episode, a queue that should drain in order
 * — is decided here, where a test can reach it.
 */

import type { PlayableEpisode } from '../player/machine.ts';

export type DownloadStatus =
  /** Waiting for a turn. */
  | 'queued'
  /** Bytes are moving. */
  | 'downloading'
  /** On disk and playable with no network at all. */
  | 'complete'
  /** Stopped and not retryable without being asked again. */
  | 'failed';

export type DownloadRecord = {
  episodeId: string;
  podcastId: string;

  /**
   * Enough of the episode to draw a row without asking anyone.
   *
   * Copied rather than referenced on purpose. The obvious alternative — store
   * ids, look the rest up — fails in exactly the situation this feature exists
   * for: on a plane, where the lookup cannot happen.
   */
  title: string;
  podcastTitle: string;
  durationSec: number | null;
  accentColor: string | null;

  /**
   * The publisher's URL.
   *
   * Kept after the download finishes, for two reasons: it is what a retry
   * points at, and it is the fallback if the local file goes missing — Android
   * can clear an app's cache without telling it, and a missing file should
   * degrade to streaming rather than to a dead row.
   */
  audioUrl: string;
  artworkUrl: string | null;

  /** Local `file://` URIs, once written. */
  fileUri: string | null;
  artworkUri: string | null;

  status: DownloadStatus;
  bytesWritten: number;
  /** `-1` when the publisher sent no `Content-Length`, which is common. */
  bytesTotal: number;
  error: string | null;

  requestedAt: number;
  completedAt: number | null;
};

/** Keyed by episode id: one episode is downloaded once or not at all. */
export type DownloadIndex = Readonly<Record<string, DownloadRecord>>;

export const EMPTY_INDEX: DownloadIndex = {};

/**
 * How many transfers run at once.
 *
 * One. Podcast audio is tens of megabytes and phones are usually on a shared,
 * metered connection — three parallel downloads do not finish sooner, they
 * finish at the same time as each other and later than the first one would
 * have. Serialising also means the episode someone asked for *first* is the
 * one that becomes playable first, which is what they were expecting.
 */
export const MAX_CONCURRENT_DOWNLOADS = 1;

// -------------------------------------------------------------- transitions --

/**
 * Ask for an episode to be saved.
 *
 * Already queued, downloading, or complete: nothing happens, and the *same*
 * index is returned so a second tap cannot restart a transfer that is halfway
 * done. A previously failed download is reset and tried again, because tapping
 * a failed row is unambiguously a request to retry.
 */
export function requestDownload(
  index: DownloadIndex,
  episode: PlayableEpisode,
  now: number,
): DownloadIndex {
  const existing = index[episode.id];
  if (existing && existing.status !== 'failed') return index;

  return {
    ...index,
    [episode.id]: {
      episodeId: episode.id,
      podcastId: episode.podcastId,
      title: episode.title,
      podcastTitle: episode.podcastTitle,
      durationSec: episode.durationSec,
      accentColor: episode.accentColor ?? null,
      audioUrl: episode.audioUrl,
      artworkUrl: episode.artworkUrl,
      fileUri: null,
      artworkUri: null,
      status: 'queued',
      bytesWritten: 0,
      bytesTotal: -1,
      error: null,
      requestedAt: now,
      completedAt: null,
    },
  };
}

export function startDownload(index: DownloadIndex, episodeId: string): DownloadIndex {
  return patch(index, episodeId, (record) =>
    record.status === 'queued' ? { ...record, status: 'downloading', error: null } : record,
  );
}

/**
 * Report bytes.
 *
 * Called several times a second by the platform layer. Returning the identical
 * index when nothing moved matters more here than anywhere else in this file:
 * every changed index is a re-render of a list, and a progress callback that
 * fires on an unchanged byte count would repaint the screen for nothing.
 */
export function advanceDownload(
  index: DownloadIndex,
  episodeId: string,
  bytesWritten: number,
  bytesTotal: number,
): DownloadIndex {
  return patch(index, episodeId, (record) => {
    if (record.bytesWritten === bytesWritten && record.bytesTotal === bytesTotal) return record;
    return { ...record, status: 'downloading', bytesWritten, bytesTotal };
  });
}

export function completeDownload(
  index: DownloadIndex,
  episodeId: string,
  saved: { fileUri: string; artworkUri: string | null; bytes: number },
  now: number,
): DownloadIndex {
  return patch(index, episodeId, (record) => ({
    ...record,
    status: 'complete',
    fileUri: saved.fileUri,
    artworkUri: saved.artworkUri,
    // The size on disk, which is authoritative — `Content-Length` is a claim
    // and plenty of CDNs omit it, leaving `bytesTotal` at -1 forever.
    bytesWritten: saved.bytes,
    bytesTotal: saved.bytes,
    error: null,
    completedAt: now,
  }));
}

export function failDownload(
  index: DownloadIndex,
  episodeId: string,
  message: string,
): DownloadIndex {
  return patch(index, episodeId, (record) => ({
    ...record,
    status: 'failed',
    error: message,
  }));
}

/** Drop an episode from the index entirely. Deleting the file is the caller's job. */
export function forgetDownload(index: DownloadIndex, episodeId: string): DownloadIndex {
  if (!(episodeId in index)) return index;

  const next = { ...index };
  delete next[episodeId];
  return next;
}

/**
 * Recover from being killed mid-transfer.
 *
 * Android streams a download straight into the destination file, so an app
 * that is terminated at 40% leaves 40% of an episode on disk with no way to
 * tell it from a whole one. There is no resume token to hold on to, so the
 * only honest move is to put it back in the queue and start again — and the
 * byte count has to be reset too, or the progress bar begins at 40% and
 * appears to go backwards.
 *
 * Called once at launch, before anything is scheduled.
 */
export function requeueInterrupted(index: DownloadIndex): DownloadIndex {
  const interrupted = Object.values(index).filter((record) => record.status === 'downloading');
  if (interrupted.length === 0) return index;

  const next = { ...index };
  for (const record of interrupted) {
    next[record.episodeId] = { ...record, status: 'queued', bytesWritten: 0, bytesTotal: -1 };
  }
  return next;
}

function patch(
  index: DownloadIndex,
  episodeId: string,
  update: (record: DownloadRecord) => DownloadRecord,
): DownloadIndex {
  const record = index[episodeId];
  if (!record) return index;

  const updated = update(record);
  if (updated === record) return index;

  return { ...index, [episodeId]: updated };
}

// ----------------------------------------------------------------- reading --

/**
 * Which episode to start next, or null when there is nothing to do.
 *
 * Oldest request first. Someone who taps three episodes in a row expects them
 * to arrive in that order — and if they close the app after the first one, the
 * one they wanted most is the one that finished.
 */
export function nextQueued(index: DownloadIndex): string | null {
  const active = Object.values(index).filter((record) => record.status === 'downloading').length;
  if (active >= MAX_CONCURRENT_DOWNLOADS) return null;

  let candidate: DownloadRecord | null = null;
  for (const record of Object.values(index)) {
    if (record.status !== 'queued') continue;
    if (!candidate || record.requestedAt < candidate.requestedAt) candidate = record;
  }

  return candidate?.episodeId ?? null;
}

/**
 * The list as a Downloads screen wants it.
 *
 * Anything still moving goes to the top — that is the part of the screen that
 * changes, and it is what someone who just tapped download came to look at.
 * Saved episodes follow, most recent first, because a download is usually
 * something you are about to listen to. Failures sink to the bottom rather
 * than being hidden: a download that quietly vanished is indistinguishable
 * from one that never started.
 */
export function listDownloads(index: DownloadIndex): DownloadRecord[] {
  const rank: Record<DownloadStatus, number> = {
    downloading: 0,
    queued: 1,
    complete: 2,
    failed: 3,
  };

  return Object.values(index).sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];

    if (a.status === 'complete' && b.status === 'complete') {
      return (b.completedAt ?? 0) - (a.completedAt ?? 0);
    }

    return a.requestedAt - b.requestedAt;
  });
}

/** Only what is actually on disk — the number a "free up space" line quotes. */
export function downloadedBytes(index: DownloadIndex): number {
  let total = 0;
  for (const record of Object.values(index)) {
    if (record.status === 'complete') total += record.bytesWritten;
  }
  return total;
}

export function completedDownloads(index: DownloadIndex): DownloadRecord[] {
  return listDownloads(index).filter((record) => record.status === 'complete');
}

/** Whether this episode can be played with the network gone. */
export function isSaved(index: DownloadIndex, episodeId: string): boolean {
  const record = index[episodeId];
  return record?.status === 'complete' && record.fileUri !== null;
}

/**
 * Fraction downloaded, or null when it cannot be known.
 *
 * Null rather than 0 for the no-`Content-Length` case, so the UI can show an
 * indeterminate bar instead of one frozen at the left edge — which reads as a
 * download that is stuck rather than one whose size the publisher withheld.
 */
export function downloadProgress(record: DownloadRecord): number | null {
  if (record.status === 'complete') return 1;
  if (record.bytesTotal <= 0) return null;
  return Math.min(1, record.bytesWritten / record.bytesTotal);
}

/**
 * Coerce whatever was on disk back into an index.
 *
 * The file was written by a previous version of this app, and a phone that was
 * killed mid-write can leave it truncated. Neither is a reason to lose
 * somebody's library or to crash on launch — a record that does not parse is
 * dropped, and the rest survive.
 *
 * A saved record is only accepted as saved if it names a file. The caller still
 * has to check the file is *there*, which this cannot do; what it can do is
 * refuse a record that never had one.
 */
export function normalizeIndex(input: unknown): DownloadIndex {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return EMPTY_INDEX;

  const index: Record<string, DownloadRecord> = {};

  for (const candidate of Object.values(input as Record<string, unknown>)) {
    if (typeof candidate !== 'object' || candidate === null) continue;

    const item = candidate as Partial<Record<keyof DownloadRecord, unknown>>;
    if (typeof item.episodeId !== 'string' || item.episodeId.length === 0) continue;
    if (typeof item.podcastId !== 'string') continue;
    if (typeof item.title !== 'string') continue;
    if (typeof item.audioUrl !== 'string' || item.audioUrl.length === 0) continue;

    const status = STATUSES.find((value) => value === item.status) ?? 'queued';
    const fileUri = typeof item.fileUri === 'string' && item.fileUri.length > 0 ? item.fileUri : null;

    index[item.episodeId] = {
      episodeId: item.episodeId,
      podcastId: item.podcastId,
      title: item.title,
      podcastTitle: typeof item.podcastTitle === 'string' ? item.podcastTitle : '',
      durationSec: finiteOrNull(item.durationSec),
      accentColor: typeof item.accentColor === 'string' ? item.accentColor : null,
      audioUrl: item.audioUrl,
      artworkUrl: typeof item.artworkUrl === 'string' ? item.artworkUrl : null,
      fileUri,
      artworkUri:
        typeof item.artworkUri === 'string' && item.artworkUri.length > 0 ? item.artworkUri : null,
      // A record claiming to be saved with nowhere to play from is not saved.
      status: status === 'complete' && !fileUri ? 'failed' : status,
      bytesWritten: finiteOr(item.bytesWritten, 0),
      bytesTotal: finiteOr(item.bytesTotal, -1),
      error: typeof item.error === 'string' ? item.error : null,
      requestedAt: finiteOr(item.requestedAt, 0),
      completedAt: finiteOrNull(item.completedAt),
    };
  }

  return index;
}

const STATUSES: readonly DownloadStatus[] = ['queued', 'downloading', 'complete', 'failed'];

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Bytes as a person reads them.
 *
 * Decimal units, matching what a phone's own storage screen says — a listener
 * comparing "1.2 GB of downloads" against Android's figure should not find
 * them disagreeing by 7% because we counted in binary.
 *
 * Not on the translator in `@cue/i18n` alongside durations, because these units
 * are unit *symbols* rather than words: MB is MB in every language this ships
 * in, where "min" is not.
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
