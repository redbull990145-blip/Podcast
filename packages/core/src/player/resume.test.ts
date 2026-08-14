import { describe, expect, it } from 'vitest';
import {
  CONCURRENT_WINDOW_MS,
  isComplete,
  reconcileProgress,
  RESUME_REWIND_SEC,
  resumePosition,
  type ProgressRecord,
} from './resume.ts';

const NOW = 1_786_000_000_000;

function record(overrides: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    positionSec: 100,
    durationSec: 3600,
    updatedAt: NOW,
    deviceId: 'device-a',
    completed: false,
    ...overrides,
  };
}

describe('reconcileProgress', () => {
  it('returns null when neither side has a record', () => {
    expect(reconcileProgress(null, null)).toBeNull();
  });

  it('takes whichever record exists', () => {
    const only = record();
    expect(reconcileProgress(only, null)?.winner).toBe(only);
    expect(reconcileProgress(null, only)?.winner).toBe(only);
  });

  /**
   * The bug this whole module exists to prevent: a phone genuinely 20 minutes
   * ahead being rewound by a laptop left paused on the same episode, purely
   * because the laptop's heartbeat landed a few seconds later.
   */
  it('never rewinds a device that is genuinely further ahead', () => {
    const phone = record({ positionSec: 2244, updatedAt: NOW, deviceId: 'phone' });
    const laptop = record({ positionSec: 130, updatedAt: NOW + 3_000, deviceId: 'laptop' });

    const result = reconcileProgress(phone, laptop);

    expect(result?.winner.deviceId).toBe('phone');
    expect(result?.reason).toBe('further-position');
  });

  it('prefers the newer record once the writes are far enough apart', () => {
    // A genuinely later listening session, where recency is the real signal —
    // you restarted the episode days later and meant to.
    const old = record({ positionSec: 3000, updatedAt: NOW });
    const recent = record({ positionSec: 40, updatedAt: NOW + CONCURRENT_WINDOW_MS + 1 });

    const result = reconcileProgress(old, recent);

    expect(result?.winner.positionSec).toBe(40);
    expect(result?.reason).toBe('more-recent');
  });

  it('treats the window boundary as concurrent', () => {
    const behind = record({ positionSec: 10, updatedAt: NOW + CONCURRENT_WINDOW_MS });
    const ahead = record({ positionSec: 900, updatedAt: NOW });

    expect(reconcileProgress(ahead, behind)?.reason).toBe('further-position');
  });

  it('lets a completion survive a stale in-progress record', () => {
    // Finishing is deliberate. A device paused mid-episode must not un-finish it.
    const finished = record({ completed: true, positionSec: 3595, updatedAt: NOW });
    const paused = record({ completed: false, positionSec: 1200, updatedAt: NOW + 5_000 });

    expect(reconcileProgress(finished, paused)?.winner.completed).toBe(true);
    expect(reconcileProgress(paused, finished)?.winner.completed).toBe(true);
  });

  it('breaks an exact tie by recency rather than arbitrarily', () => {
    const a = record({ positionSec: 500, updatedAt: NOW });
    const b = record({ positionSec: 500, updatedAt: NOW + 1_000, deviceId: 'device-b' });

    expect(reconcileProgress(a, b)?.winner.deviceId).toBe('device-b');
  });

  it('is symmetric — the same two records agree whichever way round they arrive', () => {
    const a = record({ positionSec: 2244, updatedAt: NOW, deviceId: 'a' });
    const b = record({ positionSec: 130, updatedAt: NOW + 3_000, deviceId: 'b' });

    expect(reconcileProgress(a, b)?.winner.deviceId).toBe(
      reconcileProgress(b, a)?.winner.deviceId,
    );
  });
});

describe('resumePosition', () => {
  it('starts at zero with no record', () => {
    expect(resumePosition(null)).toBe(0);
  });

  it('rewinds a few seconds, because you lose the thread before you stop', () => {
    expect(resumePosition(record({ positionSec: 600 }))).toBe(600 - RESUME_REWIND_SEC);
  });

  it('restarts a finished episode from the beginning', () => {
    // Resuming at 59:47 of a completed episode is never what anyone wants.
    expect(resumePosition(record({ positionSec: 3595, completed: true }))).toBe(0);
  });

  it('restarts an episode that is effectively finished but never marked so', () => {
    expect(resumePosition(record({ positionSec: 3595, durationSec: 3600 }))).toBe(0);
  });

  it('ignores a position so small it is noise', () => {
    expect(resumePosition(record({ positionSec: 3 }))).toBe(0);
  });

  it('never returns a negative position', () => {
    expect(resumePosition(record({ positionSec: 11 }))).toBeGreaterThanOrEqual(0);
  });

  it('handles an unknown duration without treating it as finished', () => {
    expect(resumePosition(record({ positionSec: 600, durationSec: null }))).toBe(595);
  });
});

describe('isComplete', () => {
  it('counts the padded outro as finished', () => {
    // Publishers pad the end with outros and ads; almost nobody listens to it.
    expect(isComplete(3580, 3600)).toBe(true);
  });

  it('does not count the middle as finished', () => {
    expect(isComplete(1800, 3600)).toBe(false);
  });

  it('cannot decide without a duration', () => {
    expect(isComplete(3580, null)).toBe(false);
    expect(isComplete(3580, 0)).toBe(false);
  });
});
