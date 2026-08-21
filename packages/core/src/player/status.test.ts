import { describe, expect, it } from 'vitest';
import type { EngineEvent } from './engine.ts';
import {
  describeStreamError,
  eventsFromStatus,
  initialStatusMemory,
  type StatusSnapshot,
} from './status.ts';

const idle: StatusSnapshot = {
  isLoaded: false,
  isBuffering: false,
  isPlaying: false,
  durationSec: 0,
  positionSec: 0,
  didJustFinish: false,
  error: null,
};

const snapshot = (over: Partial<StatusSnapshot> = {}): StatusSnapshot => ({ ...idle, ...over });

/** Replay a whole session and collect everything the engine would have emitted. */
function run(snapshots: StatusSnapshot[]): EngineEvent[] {
  let memory = initialStatusMemory;
  const all: EngineEvent[] = [];

  for (const status of snapshots) {
    const result = eventsFromStatus(status, memory);
    memory = result.memory;
    all.push(...result.events);
  }

  return all;
}

const typesOf = (events: EngineEvent[]) => events.map((event) => event.type);

describe('eventsFromStatus', () => {
  it('announces a load exactly once, however many ticks follow', () => {
    const events = run([
      snapshot(),
      snapshot({ isLoaded: true, durationSec: 1800 }),
      snapshot({ isLoaded: true, durationSec: 1800 }),
      snapshot({ isLoaded: true, durationSec: 1800 }),
    ]);

    expect(events.filter((event) => event.type === 'loaded')).toEqual([
      { type: 'loaded', durationSec: 1800 },
    ]);
  });

  it('reports an unknown duration as null rather than a zero-length episode', () => {
    // Live streams and sources whose metadata has not arrived both say 0. If
    // that reached the machine as a duration, every episode would look finished
    // before it began.
    const events = run([snapshot({ isLoaded: true, durationSec: 0 })]);
    expect(events).toContainEqual({ type: 'loaded', durationSec: null });
  });

  it('reports a stall on the edge, not on every tick of it', () => {
    // The regression this guards: a two-second buffer on a phone emitting
    // twenty identical events, each one a state update.
    const buffering = snapshot({ isLoaded: true, isBuffering: true });
    const events = run([buffering, buffering, buffering, buffering]);

    expect(typesOf(events).filter((type) => type === 'buffering')).toHaveLength(1);
  });

  it('reports a second stall once buffering has recovered in between', () => {
    const events = run([
      snapshot({ isLoaded: true, isBuffering: true }),
      snapshot({ isLoaded: true, isBuffering: false, isPlaying: true }),
      snapshot({ isLoaded: true, isBuffering: true, isPlaying: true }),
    ]);

    // Three edges, not two: up, back down, and up again. The falling one is
    // what tells the UI to take the spinner down, and reporting only the rises
    // is how a transport gets stuck mid-stall.
    expect(typesOf(events).filter((type) => type === 'buffering')).toHaveLength(3);
  });

  it('says when a stall ended, not only that one began', () => {
    const events = run([
      snapshot({ isLoaded: true, isBuffering: true }),
      snapshot({ isLoaded: true, isBuffering: false, isPlaying: true }),
    ]);

    expect(events.filter((event) => event.type === 'buffering')).toEqual([
      { type: 'buffering', active: true },
      { type: 'buffering', active: false },
    ]);
  });

  it('emits play and pause only when the transport actually changed', () => {
    const events = run([
      snapshot({ isLoaded: true, isPlaying: true, positionSec: 1 }),
      snapshot({ isLoaded: true, isPlaying: true, positionSec: 2 }),
      snapshot({ isLoaded: true, isPlaying: false, positionSec: 2 }),
      snapshot({ isLoaded: true, isPlaying: false, positionSec: 2 }),
      snapshot({ isLoaded: true, isPlaying: true, positionSec: 2 }),
    ]);

    expect(typesOf(events).filter((t) => t === 'playing' || t === 'paused')).toEqual([
      'playing',
      'paused',
      'playing',
    ]);
  });

  it('reports position only while playing', () => {
    // A paused player still ticks. Emitting position from it would fight a
    // scrub in progress, dragging the playhead back under the user's finger.
    const events = run([
      snapshot({ isLoaded: true, isPlaying: false, positionSec: 42 }),
      snapshot({ isLoaded: true, isPlaying: true, positionSec: 43 }),
    ]);

    expect(events.filter((event) => event.type === 'position')).toEqual([
      { type: 'position', positionSec: 43 },
    ]);
  });

  it('delivers the final position before announcing the end', () => {
    // The machine advances the queue on `ended`. If that arrived first, the
    // progress written for the finished episode would be wherever the previous
    // tick landed rather than where it actually stopped.
    const events = run([
      snapshot({ isLoaded: true, isPlaying: true, positionSec: 1799 }),
      snapshot({ isLoaded: true, isPlaying: true, positionSec: 1800, didJustFinish: true }),
    ]);

    const types = typesOf(events);
    expect(types.indexOf('position')).toBeLessThan(types.indexOf('ended'));
    expect(events.at(-1)).toEqual({ type: 'ended' });
  });

  it('treats the end as a stop, so the next episode reports its own play', () => {
    // Without clearing `wasPlaying`, the next episode's first playing tick
    // looks unchanged and never emits — the audio runs with the UI still
    // showing a play button.
    const events = run([
      snapshot({ isLoaded: true, isPlaying: true, positionSec: 1800, didJustFinish: true }),
      snapshot({ isLoaded: true, isPlaying: true, positionSec: 0 }),
    ]);

    expect(typesOf(events).filter((type) => type === 'playing')).toHaveLength(2);
  });

  it('lets an error supersede everything else in the same tick', () => {
    const events = run([
      snapshot({ isLoaded: true, isPlaying: true, positionSec: 10, error: 'HTTP 404' }),
    ]);

    expect(events).toEqual([{ type: 'error', message: 'HTTP 404' }]);
  });

  it('reports a standing error once rather than on every tick', () => {
    const failing = snapshot({ error: 'HTTP 404' });
    const events = run([failing, failing, failing]);

    expect(events).toHaveLength(1);
  });

  it('reports a different error even while one is already standing', () => {
    const events = run([snapshot({ error: 'HTTP 404' }), snapshot({ error: 'Network lost' })]);
    expect(typesOf(events)).toEqual(['error', 'error']);
  });

  it('reports a repeat of an error that had cleared in between', () => {
    const events = run([
      snapshot({ error: 'Network lost' }),
      snapshot({ isLoaded: true, error: null }),
      snapshot({ isLoaded: true, error: 'Network lost' }),
    ]);

    expect(typesOf(events).filter((type) => type === 'error')).toHaveLength(2);
  });

  it('does not mutate the memory it was given', () => {
    // The caller keeps a reference to the old memory; mutating it in place
    // would make replaying a snapshot produce different events the second time.
    const memory = { ...initialStatusMemory };
    eventsFromStatus(snapshot({ isLoaded: true, isPlaying: true }), memory);
    expect(memory).toEqual(initialStatusMemory);
  });

  it('survives a whole episode: load, play, buffer, resume, finish', () => {
    const events = run([
      snapshot(),
      snapshot({ isLoaded: true, durationSec: 600 }),
      snapshot({ isLoaded: true, durationSec: 600, isPlaying: true, positionSec: 0 }),
      snapshot({ isLoaded: true, durationSec: 600, isPlaying: true, positionSec: 120 }),
      snapshot({ isLoaded: true, durationSec: 600, isPlaying: true, isBuffering: true, positionSec: 120 }),
      snapshot({ isLoaded: true, durationSec: 600, isPlaying: true, positionSec: 121 }),
      snapshot({
        isLoaded: true,
        durationSec: 600,
        isPlaying: true,
        positionSec: 600,
        didJustFinish: true,
      }),
    ]);

    expect(typesOf(events)).toEqual([
      'loaded',
      'playing',
      'position',
      'position',
      // Into the buffer...
      'buffering',
      'position',
      // ...and out of it again. The recovery is an event in its own right, so
      // whatever put a spinner up on the way in is told to take it down.
      'buffering',
      'position',
      'position',
      'ended',
    ]);
  });
});

describe('describeStreamError', () => {
  it('names the publisher when the audio is gone', () => {
    expect(describeStreamError('Response code: 404')).toContain('publisher');
  });

  it('distinguishes a refusal from a disappearance', () => {
    expect(describeStreamError('HTTP 403 Forbidden')).not.toEqual(
      describeStreamError('HTTP 404 Not Found'),
    );
  });

  it('says a dropped connection is a connection problem, so retrying reads as worthwhile', () => {
    expect(describeStreamError('Unable to resolve host "cdn.example.com"')).toContain(
      'connection',
    );
  });

  it('explains a codec failure without naming the codec', () => {
    const message = describeStreamError('MediaCodecVideoRenderer: unsupported format');
    expect(message).toContain('format the device cannot play');
    expect(message.toLowerCase()).not.toContain('mediacodec');
  });

  it('falls back to something plain rather than echoing an opaque string', () => {
    const message = describeStreamError('ERR_UNKNOWN_0x8007');
    expect(message).toBe('This episode could not be played');
  });

  it('matches regardless of the case the platform used', () => {
    expect(describeStreamError('NETWORK ERROR')).toEqual(describeStreamError('network error'));
  });
});
