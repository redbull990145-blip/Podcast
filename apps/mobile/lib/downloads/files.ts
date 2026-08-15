import { normalizeIndex, type DownloadIndex, type DownloadRecord } from '@cue/core';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Where saved episodes actually live.
 *
 * `Paths.document`, not `Paths.cache`. The cache directory is explicitly the
 * one Android is allowed to empty when the device runs low on space, and an
 * episode someone saved for a flight disappearing the night before is the exact
 * failure this feature exists to prevent. The cost is that we are now
 * responsible for freeing it, which is what the Downloads screen is for.
 *
 * All of it is inside the app's own sandbox, so none of this needs a storage
 * permission — which is why `expo-file-system`'s config plugin is deliberately
 * *not* in `app.json`. That plugin adds READ/WRITE_EXTERNAL_STORAGE, two
 * permissions this app goes out of its way to block, to support a directory we
 * never touch.
 */
const ROOT = new Directory(Paths.document, 'downloads');
const AUDIO_DIR = new Directory(ROOT, 'audio');
const ART_DIR = new Directory(ROOT, 'art');
const INDEX_FILE = new File(ROOT, 'index.json');

export function ensureDirectories(): void {
  for (const directory of [ROOT, AUDIO_DIR, ART_DIR]) {
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  }
}

/**
 * Episode ids are UUIDs, so this is belt and braces — but the type is `string`,
 * and a path separator arriving in one would write outside the directory rather
 * than fail. Cheap to prevent, unpleasant to discover.
 */
function safeName(episodeId: string): string {
  return episodeId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Keep the publisher's extension where there is one.
 *
 * ExoPlayer sniffs the container rather than trusting the name, so this is not
 * load-bearing — but an `.mp3` on disk is what makes the file legible if
 * anyone ever goes looking, and it costs one regex.
 */
function audioExtension(url: string): string {
  const match = /\.(mp3|m4a|aac|ogg|opus|wav|flac)(?:$|\?)/i.exec(url);
  return match?.[1] ? `.${match[1].toLowerCase()}` : '.mp3';
}

export function audioFile(record: DownloadRecord): File {
  return new File(AUDIO_DIR, `${safeName(record.episodeId)}${audioExtension(record.audioUrl)}`);
}

function artworkFile(record: DownloadRecord): File {
  return new File(ART_DIR, `${safeName(record.episodeId)}.img`);
}

// ------------------------------------------------------------------- index --

/**
 * Read the index synchronously.
 *
 * The store is built from it before the first render, and an async read would
 * mean every Downloads row flashes empty on launch. It is one small JSON file
 * on internal storage — this is not the async-worthy part of the feature.
 */
export function readIndex(): DownloadIndex {
  try {
    if (!INDEX_FILE.exists) return normalizeIndex(null);
    return normalizeIndex(JSON.parse(INDEX_FILE.textSync()));
  } catch {
    // Unparseable or unreadable. `normalizeIndex` already treats a broken file
    // as an empty library rather than a crash; this catches the read itself.
    return normalizeIndex(null);
  }
}

export function writeIndex(index: DownloadIndex): void {
  try {
    ensureDirectories();
    INDEX_FILE.write(JSON.stringify(index));
  } catch {
    // The library still works this session; it just will not survive a
    // restart. Worth nobody's error dialog.
  }
}

/**
 * Drop records whose audio is no longer on disk.
 *
 * Android can clear an app's files, a restore from backup can bring an index
 * without its contents, and a download interrupted at the wrong moment can
 * leave a record pointing at nothing. A Downloads screen that lists episodes
 * which are not there is worse than one that lists fewer — so the file system
 * wins the disagreement, always.
 */
export function reconcileWithDisk(index: DownloadIndex): DownloadIndex {
  const kept: Record<string, DownloadRecord> = {};

  for (const record of Object.values(index)) {
    if (record.status !== 'complete') {
      kept[record.episodeId] = record;
      continue;
    }

    try {
      if (audioFile(record).exists) kept[record.episodeId] = record;
    } catch {
      // Unreadable counts as absent.
    }
  }

  return kept;
}

// ---------------------------------------------------------------- transfer --

export type SavedFiles = {
  fileUri: string;
  artworkUri: string | null;
  bytes: number;
};

/**
 * Pull an episode onto the device.
 *
 * The artwork is fetched too, and deliberately *after* the audio: it is the
 * smaller and less important half, and someone who cancels a download halfway
 * wanted the episode, not the cover. A cover that fails is not a failed
 * download — the record keeps the remote URL and the row looks right whenever
 * there is a connection.
 */
export async function downloadEpisode(
  record: DownloadRecord,
  options: { onProgress: (bytesWritten: number, bytesTotal: number) => void; signal: AbortSignal },
): Promise<SavedFiles> {
  ensureDirectories();

  const destination = audioFile(record);

  const task = File.createDownloadTask(record.audioUrl, destination, {
    signal: options.signal,
    onProgress: ({ bytesWritten, totalBytes }) => {
      options.onProgress(bytesWritten, totalBytes);
    },
  });

  const file = await task.downloadAsync();
  if (!file) throw new Error('The download stopped before it finished');

  return {
    fileUri: file.uri,
    artworkUri: await downloadArtwork(record),
    // The size on disk, which is the only number that is not a claim.
    bytes: file.size,
  };
}

async function downloadArtwork(record: DownloadRecord): Promise<string | null> {
  if (!record.artworkUrl) return null;

  try {
    const file = await File.downloadFileAsync(record.artworkUrl, artworkFile(record), {
      idempotent: true,
    });
    return file.uri;
  } catch {
    // Cosmetic. The record still holds the publisher's URL.
    return null;
  }
}

/**
 * Remove an episode's files.
 *
 * Best-effort per file rather than all-or-nothing: failing to delete a cover
 * must not leave thirty megabytes of audio behind, which is what a single
 * try/catch around both would do.
 */
export function deleteFiles(record: DownloadRecord): void {
  for (const file of [audioFile(record), artworkFile(record)]) {
    try {
      if (file.exists) file.delete();
    } catch {
      // Nothing useful to do. The record is going away regardless, and a file
      // we cannot delete is not a reason to keep claiming the episode is saved.
    }
  }
}
