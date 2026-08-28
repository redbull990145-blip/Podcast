import { describe, expect, it } from 'vitest';
import { canAlign, shouldOfferAlignment, type AlignableTranscript } from './alignment.ts';

const feed: AlignableTranscript = { source: 'feed', timed: true, aligned: false };

describe('canAlign', () => {
  it('accepts a timed publisher transcript that has not been corrected', () => {
    expect(canAlign(feed)).toBe(true);
  });

  it('refuses a generated transcript', () => {
    // Its timings already describe audio this server downloaded. Re-timing it
    // against a third cut of the episode would make a close answer worse.
    expect(canAlign({ ...feed, source: 'generated' })).toBe(false);
  });

  it('refuses untimed prose', () => {
    // Most publisher transcripts are HTML with no timecodes. There is no
    // timeline to correct, only zeroes to move around.
    expect(canAlign({ ...feed, timed: false })).toBe(false);
  });

  it('refuses one that has already been corrected', () => {
    expect(canAlign({ ...feed, aligned: true })).toBe(false);
  });

  it('refuses nothing at all', () => {
    expect(canAlign(null)).toBe(false);
    expect(canAlign(undefined)).toBe(false);
  });
});

describe('shouldOfferAlignment', () => {
  it('offers when the file and the cues are known to disagree', () => {
    expect(shouldOfferAlignment(feed, 8_686)).toBe(true);
  });

  it('offers when nothing has been measured', () => {
    // Null is "unknown", not "they match" — the same reading `driftMs` uses.
    expect(shouldOfferAlignment(feed, null)).toBe(true);
  });

  it('does not offer when the durations agree exactly', () => {
    expect(shouldOfferAlignment(feed, 0)).toBe(false);
  });

  it('never offers for a generated transcript, however far out it is', () => {
    expect(shouldOfferAlignment({ ...feed, source: 'generated' }, 26_000)).toBe(false);
  });
});
