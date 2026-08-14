import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration.ts';

describe('parseDuration', () => {
  it.each([
    ['plain seconds', '3600', 3600],
    ['numeric seconds', 3600, 3600],
    ['HH:MM:SS', '1:00:00', 3600],
    ['zero-padded HH:MM:SS', '01:30:45', 5445],
    ['MM:SS', '45:30', 2730],
    ['fractional seconds get rounded', '00:00:30.500', 31],
    ['spaced hours and minutes', '1h 30m', 5400],
    ['unspaced hours and minutes', '1h30m', 5400],
    ['minutes only', '90m', 5400],
    ['seconds suffix', '45s', 45],
  ])('reads %s', (_label, input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['placeholder dashes', '--'],
    ['prose', 'about an hour'],
    ['null', null],
    ['undefined', undefined],
    ['zero', '0'],
    ['negative', -50],
    ['too many segments', '1:2:3:4'],
    ['garbage inside a segment', '1:2x:00'],
  ])('returns null for %s', (_label, input) => {
    // Null is a real answer — the player discovers the true duration on load.
    // Inventing a zero would render a broken scrubber.
    expect(parseDuration(input)).toBeNull();
  });

  it('rejects an implausible duration rather than trusting the feed', () => {
    // A 40-day episode is a publisher bug, and showing it as fact is worse
    // than showing nothing.
    expect(parseDuration('9999999')).toBeNull();
  });

  it('accepts exactly 24 hours as the boundary', () => {
    expect(parseDuration('24:00:00')).toBe(86400);
  });
});
