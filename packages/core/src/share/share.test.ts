import { describe, expect, it } from 'vitest';
import {
  buildEpisodeShareUrl,
  episodeShareUrl,
  formatShareTime,
  parseShareTime,
  shouldShareTime,
} from './share.ts';

describe('formatShareTime', () => {
  it('reads as a duration rather than a number of seconds', () => {
    expect(formatShareTime(47)).toBe('47s');
    expect(formatShareTime(1471)).toBe('24m31s');
    expect(formatShareTime(3723)).toBe('1h02m03s');
  });

  it('pads only where a larger unit precedes', () => {
    // `5m03s` rather than `5m3s`, but `3s` rather than `03s`.
    expect(formatShareTime(303)).toBe('5m03s');
    expect(formatShareTime(3)).toBe('3s');
    expect(formatShareTime(3600)).toBe('1h00m00s');
  });

  it('floors a fractional position and refuses a negative one', () => {
    expect(formatShareTime(90.9)).toBe('1m30s');
    expect(formatShareTime(-5)).toBe('0s');
  });
});

describe('parseShareTime', () => {
  it('round-trips everything it writes', () => {
    for (const seconds of [0, 3, 47, 303, 1471, 3600, 3723, 86_399]) {
      expect(parseShareTime(formatShareTime(seconds))).toBe(seconds);
    }
  });

  it('accepts a bare count of seconds, with or without the unit', () => {
    expect(parseShareTime('1471')).toBe(1471);
    expect(parseShareTime('1471s')).toBe(1471);
  });

  it('accepts a partial unit form', () => {
    expect(parseShareTime('24m')).toBe(1440);
    expect(parseShareTime('2h')).toBe(7200);
    expect(parseShareTime('1h30m')).toBe(5400);
  });

  it('accepts what someone copies off a scrubber', () => {
    expect(parseShareTime('24:31')).toBe(1471);
    expect(parseShareTime('1:02:03')).toBe(3723);
  });

  it('is case and whitespace tolerant', () => {
    expect(parseShareTime('  1H02M03S ')).toBe(3723);
  });

  it('is null rather than zero for anything it cannot read', () => {
    // Zero is a real position — the start of the episode — so returning it
    // here would turn a mangled link into a link to the beginning.
    for (const input of ['', 'soon', '24m31', 'm31s', '-5', '12x', null, undefined]) {
      expect(parseShareTime(input)).toBeNull();
    }
  });

  it('refuses a value longer than any episode', () => {
    expect(parseShareTime('999999999')).toBeNull();
    expect(parseShareTime('48h')).toBeNull();
  });
});

describe('shouldShareTime', () => {
  it('drops a timestamp from the first few seconds', () => {
    expect(shouldShareTime(4, 3600)).toBe(false);
    expect(shouldShareTime(14, 3600)).toBe(false);
    expect(shouldShareTime(15, 3600)).toBe(true);
  });

  it('drops a timestamp in the outro', () => {
    expect(shouldShareTime(3580, 3600)).toBe(false);
    expect(shouldShareTime(3000, 3600)).toBe(true);
  });

  it('keeps a timestamp when the duration is unknown', () => {
    expect(shouldShareTime(1471, null)).toBe(true);
  });
});

describe('buildEpisodeShareUrl', () => {
  it('points at the web app, never a scheme only the app can open', () => {
    expect(buildEpisodeShareUrl('https://cue.app', 'ep-1', 1471)).toBe(
      'https://cue.app/episode/ep-1?t=24m31s',
    );
  });

  it('omits the parameter entirely when there is no position', () => {
    expect(buildEpisodeShareUrl('https://cue.app', 'ep-1', null)).toBe(
      'https://cue.app/episode/ep-1',
    );
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(buildEpisodeShareUrl('https://cue.app/', 'ep-1', null)).toBe(
      'https://cue.app/episode/ep-1',
    );
  });

  it('encodes an id that would otherwise break the path', () => {
    expect(buildEpisodeShareUrl('https://cue.app', 'a/b?c', null)).toBe(
      'https://cue.app/episode/a%2Fb%3Fc',
    );
  });
});

describe('episodeShareUrl', () => {
  it('includes the moment when the moment is worth sharing', () => {
    expect(
      episodeShareUrl({
        origin: 'https://cue.app',
        episodeId: 'ep-1',
        positionSec: 1471,
        durationSec: 3600,
      }),
    ).toBe('https://cue.app/episode/ep-1?t=24m31s');
  });

  it('shares the episode when playback has barely started', () => {
    expect(
      episodeShareUrl({
        origin: 'https://cue.app',
        episodeId: 'ep-1',
        positionSec: 4,
        durationSec: 3600,
      }),
    ).toBe('https://cue.app/episode/ep-1');
  });

  it('shares the episode when nothing is playing', () => {
    expect(episodeShareUrl({ origin: 'https://cue.app', episodeId: 'ep-1' })).toBe(
      'https://cue.app/episode/ep-1',
    );
  });
});
