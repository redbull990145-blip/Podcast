import { describe, expect, it } from 'vitest';
import type { PlayableEpisode } from '../player/machine.ts';
import {
  advanceDownload,
  completeDownload,
  downloadedBytes,
  downloadProgress,
  EMPTY_INDEX,
  failDownload,
  forgetDownload,
  formatBytes,
  isSaved,
  listDownloads,
  nextQueued,
  normalizeIndex,
  requestDownload,
  requeueInterrupted,
  startDownload,
  type DownloadIndex,
} from './downloads.ts';

const NOW = new Date('2026-08-15T10:00:00.000Z').getTime();

function episode(overrides: Partial<PlayableEpisode> & { id: string }): PlayableEpisode {
  return {
    podcastId: 'show-1',
    title: `Episode ${overrides.id}`,
    audioUrl: `https://cdn.example.com/${overrides.id}.mp3`,
    durationSec: 2400,
    artworkUrl: 'https://cdn.example.com/cover.jpg',
    podcastTitle: 'A Show',
    accentColor: '#334455',
    ...overrides,
  };
}

/** Queue an episode and take it all the way to complete. */
function saved(index: DownloadIndex, id: string, bytes = 30_000_000, at = NOW): DownloadIndex {
  let next = requestDownload(index, episode({ id }), at);
  next = startDownload(next, id);
  return completeDownload(next, id, { fileUri: `file:///audio/${id}.mp3`, artworkUri: null, bytes }, at);
}

describe('requestDownload', () => {
  it('carries enough of the episode to render it with no network', () => {
    const index = requestDownload(EMPTY_INDEX, episode({ id: 'e1' }), NOW);
    const record = index['e1'];

    expect(record?.title).toBe('Episode e1');
    expect(record?.podcastTitle).toBe('A Show');
    expect(record?.durationSec).toBe(2400);
    expect(record?.artworkUrl).toBe('https://cdn.example.com/cover.jpg');
    expect(record?.status).toBe('queued');
  });

  it('ignores a second tap on something already downloading', () => {
    const first = requestDownload(EMPTY_INDEX, episode({ id: 'e1' }), NOW);
    const downloading = advanceDownload(startDownload(first, 'e1'), 'e1', 5_000_000, 30_000_000);

    const again = requestDownload(downloading, episode({ id: 'e1' }), NOW + 1000);

    // The same object, not merely an equal one: a new index re-renders the
    // list, and a restart would throw away five megabytes.
    expect(again).toBe(downloading);
    expect(again['e1']?.bytesWritten).toBe(5_000_000);
  });

  it('ignores a second tap on something already saved', () => {
    const complete = saved(EMPTY_INDEX, 'e1');
    expect(requestDownload(complete, episode({ id: 'e1' }), NOW + 1000)).toBe(complete);
  });

  it('retries a failed download, clearing the error', () => {
    const failed = failDownload(startDownload(requestDownload(EMPTY_INDEX, episode({ id: 'e1' }), NOW), 'e1'), 'e1', 'Connection lost');
    expect(failed['e1']?.status).toBe('failed');

    const retried = requestDownload(failed, episode({ id: 'e1' }), NOW + 5000);
    expect(retried['e1']?.status).toBe('queued');
    expect(retried['e1']?.error).toBeNull();
  });
});

describe('advanceDownload', () => {
  it('returns the same index when no bytes moved', () => {
    const started = startDownload(requestDownload(EMPTY_INDEX, episode({ id: 'e1' }), NOW), 'e1');
    const once = advanceDownload(started, 'e1', 1_000, 30_000_000);

    expect(advanceDownload(once, 'e1', 1_000, 30_000_000)).toBe(once);
  });

  it('ignores progress for an episode that is not in the index', () => {
    expect(advanceDownload(EMPTY_INDEX, 'ghost', 1000, 2000)).toBe(EMPTY_INDEX);
  });
});

describe('completeDownload', () => {
  it('trusts the size on disk over the publisher’s Content-Length', () => {
    let index = startDownload(requestDownload(EMPTY_INDEX, episode({ id: 'e1' }), NOW), 'e1');
    // A CDN that never sent a length leaves this at -1 the whole way.
    index = advanceDownload(index, 'e1', 9_000_000, -1);
    index = completeDownload(
      index,
      'e1',
      { fileUri: 'file:///audio/e1.mp3', artworkUri: 'file:///art/e1.jpg', bytes: 31_400_000 },
      NOW + 60_000,
    );

    const record = index['e1'];
    expect(record?.bytesWritten).toBe(31_400_000);
    expect(record?.bytesTotal).toBe(31_400_000);
    expect(downloadProgress(record!)).toBe(1);
  });

  it('keeps the publisher’s URL so a lost file can still stream', () => {
    const index = saved(EMPTY_INDEX, 'e1');
    expect(index['e1']?.audioUrl).toBe('https://cdn.example.com/e1.mp3');
    expect(index['e1']?.fileUri).toBe('file:///audio/e1.mp3');
  });
});

describe('nextQueued', () => {
  it('starts the episode asked for first', () => {
    let index = requestDownload(EMPTY_INDEX, episode({ id: 'second' }), NOW + 2000);
    index = requestDownload(index, episode({ id: 'first' }), NOW);
    index = requestDownload(index, episode({ id: 'third' }), NOW + 4000);

    expect(nextQueued(index)).toBe('first');
  });

  it('holds everything back while one transfer is running', () => {
    let index = requestDownload(EMPTY_INDEX, episode({ id: 'a' }), NOW);
    index = requestDownload(index, episode({ id: 'b' }), NOW + 1000);
    index = startDownload(index, 'a');

    expect(nextQueued(index)).toBeNull();
  });

  it('moves on once the running transfer finishes', () => {
    let index = requestDownload(EMPTY_INDEX, episode({ id: 'a' }), NOW);
    index = requestDownload(index, episode({ id: 'b' }), NOW + 1000);
    index = startDownload(index, 'a');
    index = completeDownload(index, 'a', { fileUri: 'file:///a.mp3', artworkUri: null, bytes: 10 }, NOW);

    expect(nextQueued(index)).toBe('b');
  });

  it('does not retry a failure on its own', () => {
    let index = requestDownload(EMPTY_INDEX, episode({ id: 'a' }), NOW);
    index = failDownload(startDownload(index, 'a'), 'a', 'Publisher returned 404');

    expect(nextQueued(index)).toBeNull();
  });

  it('is null on an empty index', () => {
    expect(nextQueued(EMPTY_INDEX)).toBeNull();
  });
});

describe('requeueInterrupted', () => {
  it('restarts a transfer the app was killed during, from zero', () => {
    let index = startDownload(requestDownload(EMPTY_INDEX, episode({ id: 'e1' }), NOW), 'e1');
    index = advanceDownload(index, 'e1', 12_000_000, 30_000_000);

    const recovered = requeueInterrupted(index);
    const record = recovered['e1'];

    expect(record?.status).toBe('queued');
    // Reset, or the bar starts at 40% and appears to run backwards.
    expect(record?.bytesWritten).toBe(0);
    expect(record?.bytesTotal).toBe(-1);
  });

  it('leaves saved and failed downloads alone', () => {
    let index = saved(EMPTY_INDEX, 'done');
    index = failDownload(startDownload(requestDownload(index, episode({ id: 'bad' }), NOW), 'bad'), 'bad', 'nope');

    const recovered = requeueInterrupted(index);
    expect(recovered['done']?.status).toBe('complete');
    expect(recovered['bad']?.status).toBe('failed');
  });

  it('is a no-op when nothing was in flight', () => {
    const index = saved(EMPTY_INDEX, 'done');
    expect(requeueInterrupted(index)).toBe(index);
  });
});

describe('listDownloads', () => {
  it('puts what is moving on top, then newest saved, then failures', () => {
    let index = saved(EMPTY_INDEX, 'old-save', 1000, NOW - 100_000);
    index = saved(index, 'new-save', 1000, NOW);
    index = requestDownload(index, episode({ id: 'waiting' }), NOW + 1000);
    index = requestDownload(index, episode({ id: 'moving' }), NOW + 2000);
    index = startDownload(index, 'moving');
    index = failDownload(
      startDownload(requestDownload(index, episode({ id: 'broken' }), NOW + 3000), 'broken'),
      'broken',
      'Publisher returned 500',
    );

    expect(listDownloads(index).map((record) => record.episodeId)).toEqual([
      'moving',
      'waiting',
      'new-save',
      'old-save',
      'broken',
    ]);
  });
});

describe('forgetDownload', () => {
  it('removes the record', () => {
    const index = forgetDownload(saved(EMPTY_INDEX, 'e1'), 'e1');
    expect(index['e1']).toBeUndefined();
    expect(isSaved(index, 'e1')).toBe(false);
  });

  it('is a no-op for an episode that was never saved', () => {
    expect(forgetDownload(EMPTY_INDEX, 'ghost')).toBe(EMPTY_INDEX);
  });
});

describe('downloadedBytes', () => {
  it('counts only what is actually on disk', () => {
    let index = saved(EMPTY_INDEX, 'a', 20_000_000);
    index = saved(index, 'b', 30_000_000);
    // Half-transferred bytes are not space anyone can plan around.
    index = advanceDownload(
      startDownload(requestDownload(index, episode({ id: 'c' }), NOW), 'c'),
      'c',
      9_000_000,
      40_000_000,
    );

    expect(downloadedBytes(index)).toBe(50_000_000);
  });
});

describe('downloadProgress', () => {
  it('is null when the publisher sent no length', () => {
    const index = advanceDownload(
      startDownload(requestDownload(EMPTY_INDEX, episode({ id: 'e1' }), NOW), 'e1'),
      'e1',
      5_000_000,
      -1,
    );

    expect(downloadProgress(index['e1']!)).toBeNull();
  });

  it('never exceeds one when a server undercounts its own body', () => {
    const index = advanceDownload(
      startDownload(requestDownload(EMPTY_INDEX, episode({ id: 'e1' }), NOW), 'e1'),
      'e1',
      12_000_000,
      10_000_000,
    );

    expect(downloadProgress(index['e1']!)).toBe(1);
  });
});

describe('normalizeIndex', () => {
  it('reads back what was written', () => {
    const written = saved(EMPTY_INDEX, 'e1');
    expect(normalizeIndex(JSON.parse(JSON.stringify(written)))).toEqual(written);
  });

  it('drops a malformed record rather than the whole library', () => {
    const parsed = normalizeIndex({
      good: { episodeId: 'good', podcastId: 'p', title: 'T', audioUrl: 'https://x/1.mp3' },
      noUrl: { episodeId: 'noUrl', podcastId: 'p', title: 'T', audioUrl: '' },
      noId: { podcastId: 'p', title: 'T', audioUrl: 'https://x/2.mp3' },
    });

    expect(Object.keys(parsed)).toEqual(['good']);
  });

  it('refuses to call a record saved when it names no file', () => {
    const parsed = normalizeIndex({
      e1: {
        episodeId: 'e1',
        podcastId: 'p',
        title: 'T',
        audioUrl: 'https://x/1.mp3',
        status: 'complete',
        fileUri: null,
      },
    });

    expect(parsed['e1']?.status).toBe('failed');
  });

  it('is empty for anything that is not an object of records', () => {
    expect(normalizeIndex(null)).toEqual(EMPTY_INDEX);
    expect(normalizeIndex([])).toEqual(EMPTY_INDEX);
    expect(normalizeIndex('{}')).toEqual(EMPTY_INDEX);
  });
});

describe('formatBytes', () => {
  it('reads the way a phone’s storage screen does', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(400)).toBe('1 KB');
    expect(formatBytes(512_000)).toBe('512 KB');
    expect(formatBytes(31_400_000)).toBe('31 MB');
    expect(formatBytes(2_400_000_000)).toBe('2.4 GB');
  });
});
