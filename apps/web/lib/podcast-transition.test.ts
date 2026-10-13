import { describe, expect, it } from 'vitest';
import { shouldSweepPodcast } from './podcast-transition';

describe('playing podcast transitions', () => {
  it('keeps the same show quiet when its episode, artwork, or theme changes', () => {
    expect(shouldSweepPodcast('show-a', 'show-a')).toBe(false);
  });

  it('announces a different show, even if it shares the artwork color', () => {
    expect(shouldSweepPodcast('show-a', 'show-b')).toBe(true);
  });

  it('does not sweep on initial playback or when the player clears', () => {
    expect(shouldSweepPodcast(null, 'show-a')).toBe(false);
    expect(shouldSweepPodcast('show-a', null)).toBe(false);
    expect(shouldSweepPodcast(null, null)).toBe(false);
  });
});
