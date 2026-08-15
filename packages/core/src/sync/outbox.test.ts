import { describe, expect, it } from 'vitest';
import {
  dropSent,
  normalizeOutbox,
  queueProgress,
  type PendingProgress,
} from './outbox.ts';

const NOW = new Date('2026-08-15T10:00:00.000Z').getTime();

function entry(overrides: Partial<PendingProgress> & { episodeId: string }): PendingProgress {
  return {
    positionSec: 100,
    durationSec: 2400,
    completed: false,
    deviceId: 'phone',
    observedAt: NOW,
    ...overrides,
  };
}

describe('queueProgress', () => {
  it('keeps one entry per episode, the latest', () => {
    let outbox = queueProgress([], entry({ episodeId: 'e1', positionSec: 100, observedAt: NOW }));
    outbox = queueProgress(outbox, entry({ episodeId: 'e1', positionSec: 340, observedAt: NOW + 15_000 }));

    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.positionSec).toBe(340);
  });

  it('never lets an older observation overwrite a newer one', () => {
    // The case this exists for: a failed flush is re-queued behind writes that
    // happened while it was in the air.
    let outbox = queueProgress([], entry({ episodeId: 'e1', positionSec: 900, observedAt: NOW + 60_000 }));
    outbox = queueProgress(outbox, entry({ episodeId: 'e1', positionSec: 300, observedAt: NOW }));

    expect(outbox[0]?.positionSec).toBe(900);
  });

  it('keeps different episodes side by side', () => {
    let outbox = queueProgress([], entry({ episodeId: 'e1' }));
    outbox = queueProgress(outbox, entry({ episodeId: 'e2' }));

    expect(outbox.map((item) => item.episodeId)).toEqual(['e1', 'e2']);
  });

  it('carries the observation time, not the moment it was queued', () => {
    const outbox = queueProgress([], entry({ episodeId: 'e1', observedAt: NOW - 3_600_000 }));
    expect(outbox[0]?.observedAt).toBe(NOW - 3_600_000);
  });

  it('drops the oldest observations once full', () => {
    let outbox: PendingProgress[] = [];
    for (let i = 0; i < 5; i += 1) {
      outbox = queueProgress(outbox, entry({ episodeId: `e${i}`, observedAt: NOW + i }), 3);
    }

    expect(outbox.map((item) => item.episodeId)).toEqual(['e2', 'e3', 'e4']);
  });

  it('does not grow when the same episode is written repeatedly', () => {
    let outbox: PendingProgress[] = [];
    for (let i = 0; i < 500; i += 1) {
      outbox = queueProgress(outbox, entry({ episodeId: 'e1', observedAt: NOW + i }), 3);
    }

    expect(outbox).toHaveLength(1);
  });
});

describe('dropSent', () => {
  it('clears what was delivered', () => {
    const sent = entry({ episodeId: 'e1' });
    expect(dropSent([sent], [sent])).toEqual([]);
  });

  it('keeps a position that moved while the flush was in flight', () => {
    const sent = entry({ episodeId: 'e1', positionSec: 300, observedAt: NOW });
    const newer = entry({ episodeId: 'e1', positionSec: 420, observedAt: NOW + 20_000 });

    expect(dropSent([newer], [sent])).toEqual([newer]);
  });

  it('leaves episodes the flush never covered', () => {
    const sent = entry({ episodeId: 'e1' });
    const untouched = entry({ episodeId: 'e2' });

    expect(dropSent([sent, untouched], [sent])).toEqual([untouched]);
  });
});

describe('normalizeOutbox', () => {
  it('reads back what was written', () => {
    const written = [entry({ episodeId: 'e1' })];
    expect(normalizeOutbox(JSON.parse(JSON.stringify(written)))).toEqual(written);
  });

  it('skips a malformed entry rather than losing the rest', () => {
    const parsed = normalizeOutbox([
      { episodeId: 'e1', positionSec: 'halfway', observedAt: NOW, deviceId: 'phone' },
      { episodeId: '', positionSec: 10, observedAt: NOW, deviceId: 'phone' },
      { positionSec: 10, observedAt: NOW, deviceId: 'phone' },
      { episodeId: 'e4', positionSec: 10, observedAt: NOW, deviceId: 'phone' },
    ]);

    expect(parsed.map((item) => item.episodeId)).toEqual(['e4']);
  });

  it('is empty for anything that is not a list', () => {
    expect(normalizeOutbox(null)).toEqual([]);
    expect(normalizeOutbox({ e1: 300 })).toEqual([]);
    expect(normalizeOutbox('[]')).toEqual([]);
  });

  it('defaults a missing duration to unknown rather than zero', () => {
    const parsed = normalizeOutbox([
      { episodeId: 'e1', positionSec: 10, observedAt: NOW, deviceId: 'phone' },
    ]);

    expect(parsed[0]?.durationSec).toBeNull();
    expect(parsed[0]?.completed).toBe(false);
  });
});
