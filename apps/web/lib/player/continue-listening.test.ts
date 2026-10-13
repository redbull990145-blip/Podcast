import type { PlayableEpisode } from '@cue/core';
import type { ContinueEntry } from '@cue/types';
import { describe, expect, it } from 'vitest';
import { continueListeningEntries } from './continue-listening';

const current: PlayableEpisode = {
  id: 'playing', podcastId: 'show', title: 'Playing episode', audioUrl: 'https://example.test/audio.mp3',
  durationSec: 200, artworkUrl: 'https://example.test/current.jpg', podcastTitle: 'Current show',
  accentColor: '#008080',
};

function history(id: string): ContinueEntry {
  return {
    episode: {
      id, podcastId: 'old-show', guid: id, title: `Saved ${id}`, description: null,
      descriptionHtml: null, audioUrl: 'https://example.test/saved.mp3', durationSec: 180,
      publishedAt: '2026-10-01T00:00:00Z', artworkUrl: null, accentColor: null,
      episodeNumber: null, seasonNumber: null, explicit: false, transcriptUrl: null,
    },
    podcastTitle: 'Saved show', podcastArtworkUrl: 'https://example.test/saved.jpg', accentColor: '#aa6600',
    positionSec: 60, durationSec: 180, updatedAt: '2026-10-01T00:00:00Z',
  };
}

describe('Home resume selection', () => {
  it('shows the playing episode immediately before any history response', () => {
    const result = continueListeningEntries([], current, 205);
    expect(result.lead).toMatchObject({
      episode: { id: current.id, title: current.title, artworkUrl: current.artworkUrl },
      podcastTitle: current.podcastTitle, accentColor: current.accentColor, durationSec: 205,
    });
    expect(result.rest).toEqual([]);
  });

  it('overrides stale server ordering and removes the playing episode from other cards', () => {
    const items = [history('old'), history('playing'), history('third'), history('fourth')];
    const result = continueListeningEntries(items, current, 205);
    expect(result.lead?.episode.id).toBe('playing');
    expect(result.lead?.episode.title).toBe('Playing episode');
    expect(result.lead?.durationSec).toBe(205);
    expect(result.rest.map((entry) => entry.episode.id)).toEqual(['old', 'third', 'fourth']);
    expect(items[0]?.episode.id).toBe('old');
  });

  it('keeps the saved history lead when the player is empty', () => {
    const items = [history('latest'), history('older')];
    const result = continueListeningEntries(items, null, null);
    expect(result.lead).toBe(items[0]);
    expect(result.rest).toEqual([items[1]]);
  });

  it('caps other cards and preserves unknown duration until the engine supplies it', () => {
    const items = ['a', 'b', 'c', 'd'].map(history);
    const result = continueListeningEntries(items, { ...current, durationSec: null }, null);
    expect(result.lead?.durationSec).toBeNull();
    expect(result.rest).toHaveLength(3);
    expect(continueListeningEntries([], null, null).lead).toBeUndefined();
  });
});
