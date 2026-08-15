import { describe, expect, it } from 'vitest';
import type { PlayableEpisode } from '../player/machine.ts';
import type { DownloadIndex, DownloadRecord } from './downloads.ts';
import { EMPTY_INDEX } from './downloads.ts';
import { playableFromDownload, preferLocal, preferLocalAll } from './source.ts';

const EPISODE: PlayableEpisode = {
  id: 'e1',
  podcastId: 'show-1',
  title: 'The one about caching',
  audioUrl: 'https://cdn.example.com/e1.mp3',
  durationSec: 2400,
  artworkUrl: 'https://cdn.example.com/cover.jpg',
  podcastTitle: 'A Show',
  accentColor: '#334455',
};

function record(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    episodeId: 'e1',
    podcastId: 'show-1',
    title: 'The one about caching',
    podcastTitle: 'A Show',
    durationSec: 2400,
    accentColor: '#334455',
    audioUrl: 'https://cdn.example.com/e1.mp3',
    artworkUrl: 'https://cdn.example.com/cover.jpg',
    fileUri: 'file:///audio/e1.mp3',
    artworkUri: 'file:///art/e1.jpg',
    status: 'complete',
    bytesWritten: 31_400_000,
    bytesTotal: 31_400_000,
    error: null,
    requestedAt: 0,
    completedAt: 1000,
    ...overrides,
  };
}

function index(...records: DownloadRecord[]): DownloadIndex {
  return Object.fromEntries(records.map((item) => [item.episodeId, item]));
}

describe('preferLocal', () => {
  it('plays the file on disk instead of the publisher’s URL', () => {
    const resolved = preferLocal(EPISODE, index(record()));

    expect(resolved.audioUrl).toBe('file:///audio/e1.mp3');
    expect(resolved.artworkUrl).toBe('file:///art/e1.jpg');
  });

  it('leaves an episode nobody saved completely untouched', () => {
    expect(preferLocal(EPISODE, EMPTY_INDEX)).toBe(EPISODE);
  });

  it('streams a download that has not finished', () => {
    const half = record({ status: 'downloading', fileUri: null, artworkUri: null });
    expect(preferLocal(EPISODE, index(half))).toBe(EPISODE);
  });

  it('streams when the record says complete but the file is gone', () => {
    // Android may reclaim an app's storage. A row that streams beats one that
    // fails on a URI pointing at nothing.
    expect(preferLocal(EPISODE, index(record({ fileUri: null })))).toBe(EPISODE);
  });

  it('keeps the remote cover when only the audio was saved', () => {
    const resolved = preferLocal(EPISODE, index(record({ artworkUri: null })));

    expect(resolved.audioUrl).toBe('file:///audio/e1.mp3');
    expect(resolved.artworkUrl).toBe('https://cdn.example.com/cover.jpg');
  });
});

describe('preferLocalAll', () => {
  it('resolves a whole queue, so what plays next is local too', () => {
    const other: PlayableEpisode = { ...EPISODE, id: 'e2', audioUrl: 'https://cdn.example.com/e2.mp3' };
    const resolved = preferLocalAll([EPISODE, other], index(record()));

    expect(resolved[0]?.audioUrl).toBe('file:///audio/e1.mp3');
    expect(resolved[1]?.audioUrl).toBe('https://cdn.example.com/e2.mp3');
  });
});

describe('playableFromDownload', () => {
  it('rebuilds a playable episode from the record alone', () => {
    expect(playableFromDownload(record())).toEqual({
      id: 'e1',
      podcastId: 'show-1',
      title: 'The one about caching',
      audioUrl: 'file:///audio/e1.mp3',
      durationSec: 2400,
      artworkUrl: 'file:///art/e1.jpg',
      podcastTitle: 'A Show',
      accentColor: '#334455',
    });
  });

  it('falls back to the publisher when the file was reclaimed', () => {
    const playable = playableFromDownload(record({ fileUri: null, artworkUri: null }));

    expect(playable.audioUrl).toBe('https://cdn.example.com/e1.mp3');
    expect(playable.artworkUrl).toBe('https://cdn.example.com/cover.jpg');
  });
});
