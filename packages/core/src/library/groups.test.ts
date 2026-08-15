import type { LibraryPodcast } from '@cue/types';
import { describe, expect, it } from 'vitest';
import { groupLibrary } from './groups.ts';

const NOW = new Date('2026-08-14T00:00:00.000Z').getTime();

function show(overrides: Partial<LibraryPodcast> & { id: string }): LibraryPodcast {
  return {
    feedUrl: `https://example.com/${overrides.id}.xml`,
    title: overrides.id,
    author: null,
    description: null,
    artworkUrl: null,
    websiteUrl: null,
    language: 'en',
    categories: [],
    explicit: false,
    episodeCount: 10,
    lastPublishedAt: new Date(NOW - 86_400_000).toISOString(),
    accentColor: null,
    source: 'seed',
    subscribedAt: new Date(NOW - 30 * 86_400_000).toISOString(),
    newEpisodeCount: 0,
    ...overrides,
  };
}

describe('groupLibrary', () => {
  it('puts shows with unheard episodes first', () => {
    const groups = groupLibrary(
      [show({ id: 'quiet-one', newEpisodeCount: 0 }), show({ id: 'has-new', newEpisodeCount: 3 })],
      NOW,
    );

    expect(groups[0]?.id).toBe('waiting');
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['has-new']);
  });

  it('ranks the waiting group by how much is waiting', () => {
    const groups = groupLibrary(
      [
        show({ id: 'few', newEpisodeCount: 2 }),
        show({ id: 'many', newEpisodeCount: 11 }),
        show({ id: 'some', newEpisodeCount: 5 }),
      ],
      NOW,
    );

    expect(groups[0]?.items.map((i) => i.id)).toEqual(['many', 'some', 'few']);
  });

  it('separates a show that has stopped publishing', () => {
    const groups = groupLibrary(
      [
        show({
          id: 'ended',
          lastPublishedAt: new Date(NOW - 400 * 86_400_000).toISOString(),
        }),
        show({ id: 'active' }),
      ],
      NOW,
    );

    const quiet = groups.find((group) => group.id === 'quiet');
    expect(quiet?.items.map((i) => i.id)).toEqual(['ended']);
  });

  it('counts a show with unheard episodes as waiting even if it later went quiet', () => {
    // Something you haven't heard outranks the show's own publishing schedule.
    const groups = groupLibrary(
      [
        show({
          id: 'ended-but-unheard',
          newEpisodeCount: 4,
          lastPublishedAt: new Date(NOW - 400 * 86_400_000).toISOString(),
        }),
      ],
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe('waiting');
  });

  it('treats a show that never published as quiet rather than crashing', () => {
    const groups = groupLibrary([show({ id: 'empty', lastPublishedAt: null })], NOW);
    expect(groups[0]?.id).toBe('quiet');
  });

  it('drops empty groups instead of rendering empty headings', () => {
    // A two-show library must not look like a mostly-broken screen.
    const groups = groupLibrary([show({ id: 'only', newEpisodeCount: 1 })], NOW);
    expect(groups).toHaveLength(1);
  });

  it('returns nothing for an empty library', () => {
    expect(groupLibrary([], NOW)).toEqual([]);
  });

  it('survives an unparseable date', () => {
    const groups = groupLibrary([show({ id: 'bad', lastPublishedAt: 'not a date' })], NOW);
    expect(groups[0]?.id).toBe('quiet');
  });
});
