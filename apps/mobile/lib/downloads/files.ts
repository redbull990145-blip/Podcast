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
  const saved = ownedFile(record.fileUri, AUDIO_DIR);
  if (saved) return saved;
  return new File(AUDIO_DIR, `${safeName(record.episodeId)}${audioExtension(record.audioUrl)}`);
}

function artworkFile(record: DownloadRecord): File {
  const saved = ownedFile(record.artworkUri, ART_DIR);
  if (saved) return saved;
  return new File(ART_DIR, `${safeName(record.episodeId)}.img`);
}

function ownedFile(uri: string | null, directory: Directory): File | null {
  if (!uri) return null;
  const prefix = `${directory.uri.replace(/\/$/, '')}/`;
  if (!uri.startsWith(prefix)) return null;
  const name = uri.slice(prefix.length);
  if (!/^[A-Za-z0-9_-]+\.(mp3|m4a|aac|ogg|opus|wav|flac|img)$/.test(name)) return null;
  return new File(directory, name);
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
  // Only abandoned temporary files in this module's own directories. A fresh
  // process has no active transfers yet when the index is first read.
  for (const directory of [AUDIO_DIR, ART_DIR]) {
    try {
      if (!directory.exists) continue;
      for (const item of directory.list()) {
        if (item instanceof File && /^[A-Za-z0-9_-]+\.part$/.test(item.name)) removeFile(item);
      }
    } catch { /* Failure to clean partial files does not make them playable. */ }
  }
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
      const file = audioFile(record);
      if (file.exists && file.size > 0 && file.size === record.bytesWritten) kept[record.episodeId] = record;
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
  // An old transfer may still finish after cancellation. Its files must never
  // share a path with a replacement attempt.
  const transfer = `${safeName(record.episodeId)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const destination = new File(AUDIO_DIR, `${transfer}.part`);
  const published = new File(AUDIO_DIR, `${transfer}${audioExtension(record.audioUrl)}`);
  let expectedBytes = -1;

  const task = File.createDownloadTask(record.audioUrl, destination, {
    signal: options.signal,
    onProgress: ({ bytesWritten, totalBytes }) => {
      expectedBytes = totalBytes;
      options.onProgress(bytesWritten, totalBytes);
    },
  });

  try {
    const file = await task.downloadAsync();
    throwIfAborted(options.signal);
    if (!file || file.size <= 0 || (expectedBytes > 0 && file.size !== expectedBytes)) {
      throw new Error('The download stopped before it finished');
    }
    const bytes = file.size;
    file.move(published);
    const artworkUri = await downloadArtwork(record, transfer, options.signal);
    throwIfAborted(options.signal);
    return { fileUri: published.uri, artworkUri, bytes };
  } catch (error) {
    removeFile(destination);
    removeFile(published);
    removeFile(new File(ART_DIR, `${transfer}.img`));
    throw error;
  }
}

async function downloadArtwork(record: DownloadRecord, transfer: string, signal: AbortSignal): Promise<string | null> {
  if (!record.artworkUrl) return null;
  const destination = new File(ART_DIR, `${transfer}.part`);
  const published = new File(ART_DIR, `${transfer}.img`);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const deadline = setTimeout(cancel, 30_000);
  try {
    const file = await File.createDownloadTask(record.artworkUrl, destination, { signal: controller.signal }).downloadAsync();
    throwIfAborted(controller.signal);
    if (!file || file.size <= 0) throw new Error('Artwork was incomplete');
    file.move(published);
    return published.uri;
  } catch {
    removeFile(destination);
    removeFile(published);
    // Cosmetic. The record still holds the publisher's URL.
    return null;
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', cancel);
  }
}

function removeFile(file: File): void {
  try { if (file.exists) file.delete(); } catch { /* Best-effort cleanup. */ }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw Object.assign(new Error('The download was cancelled'), { name: 'AbortError' });
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
