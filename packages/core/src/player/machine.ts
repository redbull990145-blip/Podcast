/**
 * The player state machine.
 *
 * Owns the queue, the current episode, position bookkeeping, speed and the
 * sleep timer. Talks to a `PlaybackEngine` through its interface and to the UI
 * by emitting state. Contains no DOM, no React, and no timers of its own — the
 * clock is injected, so "the sleep timer fires after 20 minutes" is a test that
 * runs in a millisecond.
 *
 * The direction of data flow is the important part: **the engine reports, the
 * machine decides, the UI reads.** The UI never drives the engine directly, so
 * a component unmounting cannot desynchronise playback from what is on screen.
 */

import type { QueueMutation } from '@cue/types';
import type { EngineEvent, PlaybackEngine, PlaybackPreferences, PlaybackRate } from './engine.ts';
import { DEFAULT_PREFERENCES } from './engine.ts';
import { isComplete, resumePosition, type ProgressRecord } from './resume.ts';

/** The minimum an episode needs for the player to be able to play it. */
export type PlayableEpisode = {
  id: string;
  podcastId: string;
  title: string;
  audioUrl: string;
  /** From the feed; often absent, and corrected once the engine reports. */
  durationSec: number | null;
  artworkUrl: string | null;
  podcastTitle: string;
  /**
   * The show's artwork-derived colour, carried on the episode so the player
   * can tint its controls without a second lookup while something is playing.
   */
  accentColor?: string | null;
};

export type PlayerState = {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
  current: PlayableEpisode | null;
  /** Upcoming episodes, in order. Does not include `current`. */
  queue: PlayableEpisode[];
  positionSec: number;
  /** The engine's duration once known, else the feed's, else null. */
  durationSec: number | null;
  rate: PlaybackRate;
  volume: number;
  /** Epoch ms at which playback should stop, or null. */
  sleepAtMs: number | null;
  error: string | null;
};

export type PlayerListener = (state: PlayerState) => void;

export type MachineOptions = {
  engine: PlaybackEngine;
  /** Injected so the sleep timer is testable without waiting. */
  now?: () => number;
  /** Called when position should be persisted. Debouncing is the caller's job. */
  onProgress?: (progress: ProgressRecord) => void;
  /**
   * Called when the queue changes locally and storage should follow. Never
   * called for changes that came *from* storage — see `hydrateQueue`.
   */
  onQueueMutation?: (mutation: QueueMutation) => void;
  /**
   * The listener's saved playback settings.
   *
   * Passed at construction rather than applied afterwards so the first episode
   * already starts at the chosen speed. Setting it after playback begins is
   * audible — a second of 1× before it snaps to 1.5×.
   */
  preferences?: PlaybackPreferences;
  deviceId?: string;
};

const INITIAL: PlayerState = {
  status: 'idle',
  current: null,
  queue: [],
  positionSec: 0,
  durationSec: null,
  rate: 1,
  volume: 1,
  sleepAtMs: null,
  error: null,
};

export class PlayerMachine {
  private state: PlayerState = INITIAL;
  private readonly listeners = new Set<PlayerListener>();
  private readonly engine: PlaybackEngine;
  private readonly now: () => number;
  private readonly onProgress: ((progress: ProgressRecord) => void) | undefined;
  private readonly onQueueMutation: ((mutation: QueueMutation) => void) | undefined;
  private readonly deviceId: string;
  private preferences: PlaybackPreferences;
  private unsubscribeEngine: (() => void) | null = null;

  constructor(options: MachineOptions) {
    this.engine = options.engine;
    this.now = options.now ?? Date.now;
    this.onProgress = options.onProgress;
    this.preferences = options.preferences ?? DEFAULT_PREFERENCES;
    this.state = { ...INITIAL, rate: this.preferences.rate };
    this.onQueueMutation = options.onQueueMutation;
    this.deviceId = options.deviceId ?? 'unknown';

    this.unsubscribeEngine = this.engine.subscribe((event) => {
      this.handleEngineEvent(event);
    });
  }

  getState(): PlayerState {
    return this.state;
  }

  subscribe(listener: PlayerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  // ------------------------------------------------------------- commands --

  /**
   * Play an episode now.
   *
   * `resumeFrom` is the reconciled progress record, so the decision of *where*
   * to start lives in one tested place rather than at each call site.
   */
  async play(episode: PlayableEpisode, resumeFrom: ProgressRecord | null = null): Promise<void> {
    const startAt = resumePosition(resumeFrom);

    this.set({
      status: 'loading',
      current: episode,
      positionSec: startAt,
      durationSec: episode.durationSec,
      error: null,
    });

    try {
      await this.engine.load(episode.audioUrl, startAt);
      // Applied per source, not once at construction: both platforms reset
      // playback rate when a new source is loaded, so a saved 1.5× would
      // silently become 1× on the second episode.
      this.engine.setRate(this.state.rate);
      await this.engine.play();
    } catch (error) {
      this.set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not play this episode',
      });
    }
  }

  async resume(): Promise<void> {
    if (!this.state.current) return;
    try {
      await this.engine.play();
    } catch (error) {
      this.set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not resume',
      });
    }
  }

  pause(): void {
    this.engine.pause();
    // Persist immediately: a pause is the strongest signal that someone is
    // about to walk away, and a position lost here is a place lost.
    this.reportProgress();
  }

  async toggle(): Promise<void> {
    if (this.state.status === 'playing') {
      this.pause();
    } else {
      await this.resume();
    }
  }

  seek(positionSec: number): void {
    const clamped = this.clampPosition(positionSec);
    this.engine.seek(clamped);
    this.set({ positionSec: clamped });
  }

  skipBack(): void {
    this.seek(this.state.positionSec - this.preferences.skipBackSec);
  }

  skipForward(): void {
    this.seek(this.state.positionSec + this.preferences.skipForwardSec);
  }

  setRate(rate: PlaybackRate): void {
    this.engine.setRate(rate);
    // Kept on the preferences too, so a speed changed from the player and one
    // changed from settings are the same setting rather than two that
    // disagree the next time the app starts.
    this.preferences = { ...this.preferences, rate };
    this.set({ rate });
  }

  /**
   * Apply changed settings.
   *
   * Takes effect immediately, including on whatever is currently playing —
   * a speed control that only applies to the *next* episode reads as broken.
   */
  setPreferences(preferences: PlaybackPreferences): void {
    this.preferences = preferences;
    if (preferences.rate !== this.state.rate) this.setRate(preferences.rate);
  }

  getPreferences(): PlaybackPreferences {
    return this.preferences;
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.engine.setVolume(clamped);
    this.set({ volume: clamped });
  }

  private clampPosition(positionSec: number): number {
    const max = this.state.durationSec;
    const lower = Math.max(0, positionSec);
    return max === null ? lower : Math.min(lower, max);
  }

  // ---------------------------------------------------------------- queue --

  /**
   * Replace the queue with what storage holds.
   *
   * Silent by design: this change came *from* storage, and echoing it back
   * would write the queue you just read — harmless on one device, and an
   * endless round trip the moment two are open.
   */
  hydrateQueue(episodes: PlayableEpisode[]): void {
    this.set({ queue: episodes.filter((episode) => episode.id !== this.state.current?.id) });
  }

  /** Append to the end of the queue. */
  enqueue(...episodes: PlayableEpisode[]): void {
    const existing = new Set(this.state.queue.map((item) => item.id));
    const additions = episodes.filter(
      (episode) => !existing.has(episode.id) && episode.id !== this.state.current?.id,
    );
    if (additions.length === 0) return;

    this.set({ queue: [...this.state.queue, ...additions] });
    for (const episode of additions) {
      this.onQueueMutation?.({ type: 'add', episodeId: episode.id, playNext: false });
    }
  }

  /** Put an episode at the front, so it plays after the current one. */
  playNext(episode: PlayableEpisode): void {
    const rest = this.state.queue.filter((item) => item.id !== episode.id);
    this.set({ queue: [episode, ...rest] });
    this.onQueueMutation?.({ type: 'add', episodeId: episode.id, playNext: true });
  }

  removeFromQueue(episodeId: string): void {
    if (!this.state.queue.some((item) => item.id === episodeId)) return;

    this.set({ queue: this.state.queue.filter((item) => item.id !== episodeId) });
    this.onQueueMutation?.({ type: 'remove', episodeId });
  }

  reorderQueue(episodeIds: string[]): void {
    const byId = new Map(this.state.queue.map((item) => [item.id, item]));
    const reordered = episodeIds
      .map((id) => byId.get(id))
      .filter((item): item is PlayableEpisode => item !== undefined);

    // Anything the caller did not mention keeps its relative order at the end,
    // so a reorder computed against a stale list cannot silently drop items.
    const mentioned = new Set(episodeIds);
    const remainder = this.state.queue.filter((item) => !mentioned.has(item.id));

    const queue = [...reordered, ...remainder];
    this.set({ queue });
    // The full resulting order, not the caller's partial list: storage rewrites
    // keys from it, and it must not disagree with what is on screen.
    this.onQueueMutation?.({ type: 'reorder', episodeIds: queue.map((item) => item.id) });
  }

  clearQueue(): void {
    if (this.state.queue.length === 0) return;

    this.set({ queue: [] });
    this.onQueueMutation?.({ type: 'clear' });
  }

  /** Advance to the next queued episode, or stop if the queue is empty. */
  async next(): Promise<void> {
    const [head, ...rest] = this.state.queue;

    if (!head) {
      this.engine.pause();
      this.set({ status: 'ended' });
      return;
    }

    this.set({ queue: rest });
    // Playing an episode takes it out of the queue everywhere, not just here —
    // otherwise the next device to sync puts it back and it plays twice.
    this.onQueueMutation?.({ type: 'remove', episodeId: head.id });

    await this.play(head);
  }

  // --------------------------------------------------------- sleep timer --

  /**
   * Stop playback after `minutes`.
   *
   * Stored as a wall-clock deadline rather than a countdown, because a
   * countdown driven by a JS timer drifts when the tab is backgrounded or the
   * phone sleeps — which is exactly when a sleep timer is running.
   */
  setSleepTimer(minutes: number | null): void {
    this.set({ sleepAtMs: minutes === null ? null : this.now() + minutes * 60_000 });
  }

  /** True when the deadline has passed and playback was stopped. */
  private checkSleepTimer(): boolean {
    const deadline = this.state.sleepAtMs;
    if (deadline === null || this.now() < deadline) return false;

    this.engine.pause();
    this.set({ sleepAtMs: null });
    this.reportProgress();
    return true;
  }

  // --------------------------------------------------------------- engine --

  private handleEngineEvent(event: EngineEvent): void {
    switch (event.type) {
      case 'loaded': {
        // The engine's duration is authoritative — feeds lie about it, and
        // plenty omit it entirely.
        this.set({ durationSec: event.durationSec ?? this.state.durationSec });
        break;
      }

      case 'position': {
        this.set({ positionSec: event.positionSec });
        // Checked on the position tick rather than by its own timer: the engine
        // already reports regularly, and a second timer is a second thing that
        // can drift out of step with playback.
        this.checkSleepTimer();
        break;
      }

      case 'playing':
        this.set({ status: 'playing', error: null });
        break;

      case 'paused':
        this.set({ status: 'paused' });
        break;

      case 'ended': {
        this.reportProgress(true);
        void this.next();
        break;
      }

      case 'stalled':
        // Buffering is not an error and must not replace the UI with one. The
        // status stays as it was; the engine will resume or eventually error.
        break;

      case 'error':
        this.set({ status: 'error', error: event.message });
        break;
    }
  }

  private reportProgress(forceComplete = false): void {
    const episode = this.state.current;
    if (!episode || !this.onProgress) return;

    const positionSec = this.engine.getPosition();

    this.onProgress({
      positionSec,
      durationSec: this.state.durationSec,
      updatedAt: this.now(),
      deviceId: this.deviceId,
      completed: forceComplete || isComplete(positionSec, this.state.durationSec),
    });
  }

  /** Persist now — called on pause, unload, and app backgrounding. */
  flush(): void {
    this.reportProgress();
  }

  destroy(): void {
    this.unsubscribeEngine?.();
    this.unsubscribeEngine = null;
    this.listeners.clear();
    this.engine.destroy();
  }
}
