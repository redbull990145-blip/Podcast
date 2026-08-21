import type { QueueMutation } from '@cue/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EngineEvent,
  EngineListener,
  PlaybackEngine,
  PlaybackPreferences,
} from './engine.ts';
import { DEFAULT_PREFERENCES, normalizePreferences } from './engine.ts';
import { PlayerMachine, type PlayableEpisode } from './machine.ts';
import type { ProgressRecord } from './resume.ts';

/**
 * A fake engine.
 *
 * This is the payoff of the interface seam: every behaviour below — queue
 * advance, sleep timer, resume, buffering — is verified with no browser, no
 * audio element, and no waiting.
 */
class FakeEngine implements PlaybackEngine {
  loaded: { url: string; startAt: number } | null = null;
  position = 0;
  rate = 1;
  volume = 1;
  destroyed = false;
  playCalls = 0;
  pauseCalls = 0;
  private failNextLoad = false;
  private readonly listeners = new Set<EngineListener>();

  async load(url: string, startAtSec: number): Promise<void> {
    if (this.failNextLoad) {
      this.failNextLoad = false;
      throw new Error('Network unreachable');
    }
    this.loaded = { url, startAt: startAtSec };
    this.position = startAtSec;
  }

  async play(): Promise<void> {
    this.playCalls += 1;
    this.emit({ type: 'playing' });
  }

  pause(): void {
    this.pauseCalls += 1;
    this.emit({ type: 'paused' });
  }

  seek(positionSec: number): void {
    this.position = positionSec;
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  setVolume(volume: number): void {
    this.volume = volume;
  }

  getPosition(): number {
    return this.position;
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.destroyed = true;
  }

  // -- test helpers --
  emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  advanceTo(positionSec: number): void {
    this.position = positionSec;
    this.emit({ type: 'position', positionSec });
  }

  breakNextLoad(): void {
    this.failNextLoad = true;
  }
}

function episode(id: string, overrides: Partial<PlayableEpisode> = {}): PlayableEpisode {
  return {
    id,
    podcastId: 'show-1',
    title: `Episode ${id}`,
    audioUrl: `https://cdn.example.com/${id}.mp3`,
    durationSec: 3600,
    artworkUrl: null,
    podcastTitle: 'A Show',
    ...overrides,
  };
}

const NOW = 1_786_000_000_000;

let engine: FakeEngine;
let clock: number;
let progress: ProgressRecord[];
let mutations: QueueMutation[];
let machine: PlayerMachine;

beforeEach(() => {
  engine = new FakeEngine();
  clock = NOW;
  progress = [];
  mutations = [];
  machine = new PlayerMachine({
    engine,
    now: () => clock,
    onProgress: (record) => progress.push(record),
    onQueueMutation: (mutation) => mutations.push(mutation),
    deviceId: 'test-device',
  });
});

describe('playback', () => {
  it('loads and plays from the start when there is no history', async () => {
    await machine.play(episode('a'));

    expect(engine.loaded).toEqual({ url: 'https://cdn.example.com/a.mp3', startAt: 0 });
    expect(machine.getState().status).toBe('playing');
  });

  it('resumes from a stored position, rewound slightly', async () => {
    await machine.play(episode('a'), {
      positionSec: 600,
      durationSec: 3600,
      updatedAt: NOW,
      deviceId: 'phone',
      completed: false,
    });

    // Seeking as part of load, not after: loading then seeking plays a
    // fraction of a second from zero first, which is audible.
    expect(engine.loaded?.startAt).toBe(595);
  });

  it('restarts a finished episode rather than resuming at its last second', async () => {
    await machine.play(episode('a'), {
      positionSec: 3595,
      durationSec: 3600,
      updatedAt: NOW,
      deviceId: 'phone',
      completed: true,
    });

    expect(engine.loaded?.startAt).toBe(0);
  });

  it('surfaces a load failure as an error state, not a crash', async () => {
    engine.breakNextLoad();
    await machine.play(episode('a'));

    const state = machine.getState();
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/unreachable/i);
    // The episode stays on screen so the user can retry rather than being
    // dumped back to an empty player.
    expect(state.current?.id).toBe('a');
  });

  it('prefers the engine’s duration over the feed’s', async () => {
    await machine.play(episode('a', { durationSec: 3600 }));
    engine.emit({ type: 'loaded', durationSec: 3311 });

    // Feeds lie about duration constantly and plenty omit it.
    expect(machine.getState().durationSec).toBe(3311);
  });

  it('keeps the feed duration when the engine cannot determine one', async () => {
    await machine.play(episode('a', { durationSec: 3600 }));
    engine.emit({ type: 'loaded', durationSec: null });

    expect(machine.getState().durationSec).toBe(3600);
  });

  it('does not treat buffering as an error', async () => {
    await machine.play(episode('a'));
    engine.emit({ type: 'buffering', active: true });

    // Replacing the UI with an error because a train went into a tunnel is
    // the single most annoying thing a player can do.
    expect(machine.getState().status).toBe('playing');
    expect(machine.getState().error).toBeNull();
  });

  it('reports buffering without disturbing the transport', async () => {
    await machine.play(episode('a'));
    engine.emit({ type: 'buffering', active: true });

    // The episode is still the current one and the button still means pause —
    // that is why this is a flag rather than a status. What changes is only
    // that the UI can now say the audio is waiting.
    expect(machine.getState().buffering).toBe(true);
    expect(machine.getState().status).toBe('playing');
  });

  it('clears buffering once audio flows again', async () => {
    await machine.play(episode('a'));
    engine.emit({ type: 'buffering', active: true });
    engine.emit({ type: 'buffering', active: false });

    expect(machine.getState().buffering).toBe(false);
  });

  /**
   * The bug this whole flag exists for.
   *
   * Seeking into an unbuffered stretch leaves the element waiting, and on the
   * web that never re-fires `play` — so if only the rising edge were reported
   * the player would sit showing a pause button over silence until the episode
   * ended. `playing` has to be able to clear it on its own.
   */
  it('clears buffering when playback resumes without an explicit end', async () => {
    await machine.play(episode('a'));
    engine.emit({ type: 'buffering', active: true });
    engine.emit({ type: 'playing' });

    expect(machine.getState().buffering).toBe(false);
  });

  it('does not leave a spinner over a paused episode', async () => {
    await machine.play(episode('a'));
    engine.emit({ type: 'buffering', active: true });
    engine.emit({ type: 'paused' });

    expect(machine.getState().buffering).toBe(false);
  });
});

describe('seeking', () => {
  beforeEach(async () => {
    await machine.play(episode('a'));
    engine.emit({ type: 'loaded', durationSec: 3600 });
  });

  it('skips back further than nothing and forward past an ad', () => {
    engine.advanceTo(600);

    machine.skipBack();
    expect(machine.getState().positionSec).toBe(585);

    machine.skipForward();
    expect(machine.getState().positionSec).toBe(615);
  });

  it('cannot seek before the beginning', () => {
    engine.advanceTo(5);
    machine.skipBack();
    expect(machine.getState().positionSec).toBe(0);
  });

  it('cannot seek past the end', () => {
    engine.advanceTo(3590);
    machine.skipForward();
    expect(machine.getState().positionSec).toBe(3600);
  });

  it('allows seeking past the feed duration when the real length is unknown', async () => {
    const open = new PlayerMachine({ engine: new FakeEngine(), now: () => clock });
    await open.play(episode('b', { durationSec: null }));
    open.seek(99_999);

    expect(open.getState().positionSec).toBe(99_999);
  });
});

describe('queue', () => {
  it('advances to the next episode when one ends', async () => {
    await machine.play(episode('a'));
    machine.enqueue(episode('b'), episode('c'));

    engine.emit({ type: 'ended' });
    await vi.waitFor(() => expect(machine.getState().current?.id).toBe('b'));

    expect(machine.getState().queue.map((item) => item.id)).toEqual(['c']);
  });

  it('stops at the end of the queue instead of looping', async () => {
    await machine.play(episode('a'));
    engine.emit({ type: 'ended' });

    await vi.waitFor(() => expect(machine.getState().status).toBe('ended'));
  });

  it('refuses to queue a duplicate', () => {
    machine.enqueue(episode('b'));
    machine.enqueue(episode('b'));

    expect(machine.getState().queue).toHaveLength(1);
  });

  it('refuses to queue what is already playing', async () => {
    await machine.play(episode('a'));
    machine.enqueue(episode('a'));

    expect(machine.getState().queue).toHaveLength(0);
  });

  it('moves an already-queued episode to the front rather than duplicating it', () => {
    machine.enqueue(episode('b'), episode('c'), episode('d'));
    machine.playNext(episode('d'));

    expect(machine.getState().queue.map((item) => item.id)).toEqual(['d', 'b', 'c']);
  });

  it('keeps unmentioned items when reordering against a stale list', () => {
    // A reorder computed before another device added an episode must not
    // silently delete it.
    machine.enqueue(episode('b'), episode('c'), episode('d'));
    machine.reorderQueue(['d', 'b']);

    expect(machine.getState().queue.map((item) => item.id)).toEqual(['d', 'b', 'c']);
  });

  it('ignores unknown ids in a reorder', () => {
    machine.enqueue(episode('b'));
    machine.reorderQueue(['ghost', 'b']);

    expect(machine.getState().queue.map((item) => item.id)).toEqual(['b']);
  });
});

describe('playAt', () => {
  it('starts exactly where it was told, not where the resume rules would', async () => {
    // `play` with a record at 1471 would rewind five seconds. A shared link is
    // an instruction rather than a resume, and 24:31 means 24:31.
    await machine.playAt(episode('a'), 1471);

    expect(engine.loaded).toEqual({ url: 'https://cdn.example.com/a.mp3', startAt: 1471 });
    expect(machine.getState().positionSec).toBe(1471);
  });

  it('does not treat an early position as never having started', async () => {
    // `resumePosition` sends anything under ten seconds back to zero. A link
    // that says "from 0:12" has to land on 0:12.
    await machine.playAt(episode('a'), 12);

    expect(engine.loaded?.startAt).toBe(12);
  });

  it('refuses a negative position rather than handing it to the engine', async () => {
    await machine.playAt(episode('a'), -30);

    expect(engine.loaded?.startAt).toBe(0);
  });

  it('still applies the saved playback speed', async () => {
    machine.setRate(1.5);
    await machine.playAt(episode('a'), 900);

    expect(engine.rate).toBe(1.5);
  });
});

describe('sleep timer', () => {
  it('stops playback once the deadline passes', async () => {
    await machine.play(episode('a'));
    machine.setSleepTimer(20);

    clock = NOW + 19 * 60_000;
    engine.advanceTo(1140);
    expect(engine.pauseCalls).toBe(0);

    clock = NOW + 20 * 60_000 + 1;
    engine.advanceTo(1201);

    expect(engine.pauseCalls).toBe(1);
    expect(machine.getState().sleepAtMs).toBeNull();
  });

  it('can be cancelled', async () => {
    await machine.play(episode('a'));
    machine.setSleepTimer(20);
    machine.setSleepTimer(null);

    clock = NOW + 60 * 60_000;
    engine.advanceTo(3000);

    expect(engine.pauseCalls).toBe(0);
  });

  it('survives the tab being backgrounded across the deadline', async () => {
    // A wall-clock deadline rather than a countdown: a JS countdown drifts or
    // freezes when backgrounded, which is exactly when a sleep timer runs.
    await machine.play(episode('a'));
    machine.setSleepTimer(30);

    clock = NOW + 45 * 60_000;
    engine.advanceTo(2700);

    expect(engine.pauseCalls).toBe(1);
  });
});

describe('progress reporting', () => {
  it('persists immediately on pause', async () => {
    await machine.play(episode('a'));
    engine.advanceTo(742);
    machine.pause();

    // A pause is the strongest signal someone is about to walk away.
    expect(progress.at(-1)).toMatchObject({ positionSec: 742, deviceId: 'test-device' });
  });

  it('marks an episode complete when it ends', async () => {
    await machine.play(episode('a'));
    engine.advanceTo(3600);
    engine.emit({ type: 'ended' });

    expect(progress.at(-1)?.completed).toBe(true);
  });

  it('marks the padded outro as complete', async () => {
    await machine.play(episode('a'));
    engine.emit({ type: 'loaded', durationSec: 3600 });
    engine.advanceTo(3585);
    machine.flush();

    expect(progress.at(-1)?.completed).toBe(true);
  });

  it('does not report progress with nothing playing', () => {
    machine.flush();
    expect(progress).toHaveLength(0);
  });
});

describe('lifecycle', () => {
  it('notifies subscribers of state changes', async () => {
    const seen: string[] = [];
    machine.subscribe((state) => seen.push(state.status));

    await machine.play(episode('a'));

    expect(seen).toContain('loading');
    expect(seen).toContain('playing');
  });

  it('stops notifying after unsubscribe', async () => {
    let calls = 0;
    const stop = machine.subscribe(() => {
      calls += 1;
    });
    stop();

    await machine.play(episode('a'));
    expect(calls).toBe(0);
  });

  it('releases the engine on destroy', () => {
    machine.destroy();
    expect(engine.destroyed).toBe(true);
  });

  it('clamps volume to a valid range', () => {
    machine.setVolume(5);
    expect(machine.getState().volume).toBe(1);

    machine.setVolume(-1);
    expect(machine.getState().volume).toBe(0);
  });
});

describe('queue sync', () => {
  it('reports an append so storage can create the row', () => {
    machine.enqueue(episode('b'));

    expect(mutations).toEqual([{ type: 'add', episodeId: 'b', playNext: false }]);
  });

  it('reports one mutation per episode in a bulk append', () => {
    machine.enqueue(episode('b'), episode('c'));

    expect(mutations).toEqual([
      { type: 'add', episodeId: 'b', playNext: false },
      { type: 'add', episodeId: 'c', playNext: false },
    ]);
  });

  it('distinguishes playing next from appending', () => {
    machine.playNext(episode('b'));

    expect(mutations).toEqual([{ type: 'add', episodeId: 'b', playNext: true }]);
  });

  it('says nothing when a duplicate is rejected', () => {
    machine.enqueue(episode('b'));
    mutations.length = 0;

    machine.enqueue(episode('b'));

    // The local state did not change, so neither should storage — writing here
    // would undo a concurrent reorder for nothing.
    expect(mutations).toEqual([]);
  });

  it('says nothing when removing something that is not queued', () => {
    machine.removeFromQueue('nope');
    expect(mutations).toEqual([]);
  });

  it('says nothing when clearing an already-empty queue', () => {
    machine.clearQueue();
    expect(mutations).toEqual([]);
  });

  it('reports the full resulting order on a reorder, not the caller list', () => {
    machine.enqueue(episode('b'), episode('c'), episode('d'));
    mutations.length = 0;

    // A stale caller mentions only two of the three.
    machine.reorderQueue(['d', 'b']);

    expect(mutations).toEqual([{ type: 'reorder', episodeIds: ['d', 'b', 'c'] }]);
  });

  it('removes an episode from storage when it starts playing off the queue', async () => {
    await machine.play(episode('a'));
    machine.enqueue(episode('b'));
    mutations.length = 0;

    await machine.next();

    // Otherwise the next device to sync puts it back and it plays twice.
    expect(mutations).toEqual([{ type: 'remove', episodeId: 'b' }]);
  });

  it('does not report a queue that came from storage', () => {
    machine.hydrateQueue([episode('b'), episode('c')]);

    expect(machine.getState().queue.map((item) => item.id)).toEqual(['b', 'c']);
    // Echoing this back would write the queue we just read — an endless round
    // trip the moment a second device is open.
    expect(mutations).toEqual([]);
  });

  it('drops the playing episode when hydrating', async () => {
    await machine.play(episode('a'));

    machine.hydrateQueue([episode('a'), episode('b')]);

    // Storage still lists it because the write removing it has not landed yet.
    expect(machine.getState().queue.map((item) => item.id)).toEqual(['b']);
  });

  it('works with no sync callback at all', () => {
    const offline = new PlayerMachine({ engine: new FakeEngine() });

    // Anonymous listeners get a working queue that simply is not persisted.
    expect(() => offline.enqueue(episode('b'))).not.toThrow();
    expect(offline.getState().queue).toHaveLength(1);
  });
});

describe('playback preferences', () => {
  function withPreferences(preferences: Partial<PlaybackPreferences>) {
    const fake = new FakeEngine();
    const player = new PlayerMachine({
      engine: fake,
      preferences: { ...DEFAULT_PREFERENCES, ...preferences },
    });
    return { fake, player };
  }

  it('starts at the saved speed rather than at 1', () => {
    const { player } = withPreferences({ rate: 1.5 });

    // A player that forgets speed makes every session start by fixing the
    // player.
    expect(player.getState().rate).toBe(1.5);
  });

  it('applies the saved speed to each new source', async () => {
    const { fake, player } = withPreferences({ rate: 2 });
    await player.play(episode('a'));

    // Both platforms reset playback rate when a source is replaced, so this
    // has to happen per load rather than once at construction.
    expect(fake.rate).toBe(2);
  });

  it('honours custom skip intervals', async () => {
    const { fake, player } = withPreferences({ skipBackSec: 30, skipForwardSec: 45 });
    await player.play(episode('a'));
    fake.emit({ type: 'loaded', durationSec: 3600 });
    fake.advanceTo(600);

    player.skipBack();
    expect(player.getState().positionSec).toBe(570);

    player.skipForward();
    expect(player.getState().positionSec).toBe(615);
  });

  it('applies a speed change to what is already playing', async () => {
    const { fake, player } = withPreferences({});
    await player.play(episode('a'));

    player.setPreferences({ ...DEFAULT_PREFERENCES, rate: 1.75 });

    // A speed control that only affects the *next* episode reads as broken.
    expect(fake.rate).toBe(1.75);
    expect(player.getState().rate).toBe(1.75);
  });

  it('remembers a speed set from the player, not just from settings', () => {
    const { player } = withPreferences({});
    player.setRate(1.2);

    // Otherwise the two controls are the same setting only until you restart.
    expect(player.getPreferences().rate).toBe(1.2);
  });

  it('falls back to defaults when nothing is stored', () => {
    const player = new PlayerMachine({ engine: new FakeEngine() });

    expect(player.getPreferences()).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('normalizePreferences', () => {
  it('accepts a valid stored shape', () => {
    expect(normalizePreferences({ rate: 1.5, skipBackSec: 30, skipForwardSec: 45 })).toEqual({
      rate: 1.5,
      skipBackSec: 30,
      skipForwardSec: 45,
    });
  });

  it('rejects a speed that is not on the list', () => {
    // 47× is not a speed. Some platforms throw; the ones that don't play
    // unintelligibly.
    expect(normalizePreferences({ rate: 47 }).rate).toBe(1);
  });

  it('rejects a speed of the wrong type', () => {
    expect(normalizePreferences({ rate: 'fast' }).rate).toBe(1);
  });

  it('rejects skip intervals that are not offered', () => {
    const clean = normalizePreferences({ skipBackSec: 9999, skipForwardSec: -5 });

    expect(clean.skipBackSec).toBe(15);
    expect(clean.skipForwardSec).toBe(30);
  });

  it('survives junk from a store the user can edit', () => {
    expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences('nonsense')).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
  });
});
