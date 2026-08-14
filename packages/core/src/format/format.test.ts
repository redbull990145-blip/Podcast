import { describe, expect, it } from 'vitest';
import { formatTimestamp } from './format.ts';

describe('formatTimestamp', () => {
  it.each([
    [42, '0:42'],
    [727, '12:07'],
    [3800, '1:03:20'],
  ])('%i seconds → %s', (seconds, expected) => {
    expect(formatTimestamp(seconds)).toBe(expected);
  });

  it('clamps a negative position instead of rendering a minus sign', () => {
    expect(formatTimestamp(-5)).toBe('0:00');
  });

  it('always pads seconds so the scrubber does not jitter', () => {
    expect(formatTimestamp(65)).toBe('1:05');
  });
});
