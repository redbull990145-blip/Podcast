import type { EngineEvent, EngineListener, PlaybackEngine } from '@cue/core';
import { subscribeToFrames } from './frame-clock';

/**
 * The web audio engine.
 *
 * The engine and its active `<audio>` element live outside React. That
 * is the whole point: React owns what is on screen, and what is on screen
 * changes on every navigation. An element owned by a component would be torn
 * down and recreated by a route change, and playback would stop mid-sentence
 * — the single most unforgivable bug a podcast app can have.
 *
 * Source replacement gives each element its own event ownership. The engine
 * lives in a module singleton, the machine talks to it through
 * the `PlaybackEngine` interface, and React only ever reads state.
 */
export class WebAudioEngine implements PlaybackEngine {
  private finishLoad: (() => void) | null = null;

  cancelLoad(): void {
    this.finishLoad?.();
    this.finishLoad = null;
  }
  private audio: HTMLAudioElement;
  private readonly listeners = new Set<EngineListener>();
  /** Unsubscribes the position loop from the shared frame clock. */
  private stopFrames: (() => void) | null = null;
  /** Mirrors what was last reported, so repeats are not sent. */
  private buffering = false;

  constructor() {
    this.audio = this.createAudio();
  }

  private createAudio(): HTMLAudioElement {
    const audio = new Audio();
    const listen = (type: string, callback: () => void): void => {
      audio.addEventListener(type, () => { if (this.audio === audio) callback(); });
    };

    // Podcast audio is large and streamed; `metadata` gets duration without
    // pulling the whole file before the user has pressed play.
    audio.preload = 'metadata';
    // Publisher CDNs vary wildly in CORS support. Leaving this unset keeps
    // plain playback working everywhere — it is only setting `crossOrigin`
    // that makes a non-CORS host fail outright.
    audio.crossOrigin = null;

    listen('loadedmetadata', () => {
      this.emit({
        type: 'loaded',
        // Live streams report Infinity; that is "unknown", not a duration.
        durationSec: Number.isFinite(this.audio.duration) ? this.audio.duration : null,
      });
    });

    listen('play', () => {
      this.emit({ type: 'playing' });
      this.startPositionLoop();
    });

    listen('pause', () => {
      this.setBuffering(false);
      this.emit({ type: 'paused' });
      this.stopPositionLoop();
    });

    listen('ended', () => {
      this.setBuffering(false);
      this.stopPositionLoop();
      this.emit({ type: 'ended' });
    });

    /*
      The four events that bracket a stall.

      `waiting` and `seeking` open one; `playing` and `canplay` close it. The
      pairing is not symmetrical by accident — `playing` is a different event
      from `play`, and it is the one that matters here. A seek performed while
      the element is already playing never re-fires `play`, because the element
      was never paused, so listening only for `play` meant nothing in this class
      could observe a seek finishing. That is the missing signal that left the
      transport showing a pause button over several seconds of silence every
      time somebody dragged the scrubber.
    */
    listen('waiting', () => this.setBuffering(true));
    listen('seeking', () => {
      // Only a seek that has to fetch. Landing inside an already-buffered range
      // resolves within a frame or two, and flashing a spinner for that reads
      // as the app stuttering rather than as it working.
      if (!this.isBuffered(this.audio.currentTime)) this.setBuffering(true);
    });
    listen('playing', () => this.setBuffering(false));
    listen('canplay', () => this.setBuffering(false));

    listen('error', () => {
      this.setBuffering(false);
      this.emit({ type: 'error', message: describeMediaError(this.audio.error) });
      this.stopPositionLoop();
    });
    return audio;
  }

  /**
   * Emit only on a change of state.
   *
   * `waiting` and `canplay` both fire repeatedly around a single stall, and the
   * machine pushes every event into React state — so reporting each one would
   * re-render the player several times to say the same thing twice.
   */
  private setBuffering(active: boolean): void {
    if (this.buffering === active) return;
    this.buffering = active;
    this.emit({ type: 'buffering', active });
  }

  /**
   * Whether a position already has data behind it.
   *
   * `buffered` is a list of ranges rather than one, because seeking around an
   * episode leaves the browser holding several disconnected stretches of it.
   */
  private isBuffered(positionSec: number): boolean {
    const ranges = this.audio.buffered;

    for (let i = 0; i < ranges.length; i += 1) {
      if (positionSec >= ranges.start(i) && positionSec <= ranges.end(i)) return true;
    }

    return false;
  }

  /**
   * Position updates.
   *
   * Driven by `requestAnimationFrame` rather than the element's own
   * `timeupdate`, which browsers fire at an inconsistent 4–66Hz — visibly
   * uneven under a progress bar. rAF also stops automatically in a background
   * tab, so a paused-and-hidden page costs nothing.
   *
   * The emitted value is throttled to ~4/s, because *this* feeds React state.
   * The smooth per-frame motion is interpolated in the UI from a MotionValue,
   * which never re-renders anything.
   */
  private startPositionLoop(): void {
    if (this.stopFrames !== null) return;

    let lastEmit = 0;

    /**
     * Shares the app's one frame loop rather than opening a second.
     *
     * This callback only does something four times a second, but it used to
     * wake at the display's refresh rate to find that out — 140 callbacks to
     * perform four, on top of the loop every playhead-following component was
     * already running. Subscribing here means the whole app has a single rAF
     * chain, and this emit lands in the same frame as the reads it feeds.
     */
    this.stopFrames = subscribeToFrames((timestamp) => {
      if (timestamp - lastEmit < 250) return;
      lastEmit = timestamp;
      this.emit({ type: 'position', positionSec: this.audio.currentTime });
    });
  }

  private stopPositionLoop(report = true): void {
    if (this.stopFrames === null) return;
    this.stopFrames();
    this.stopFrames = null;
    // One final reading, so the stored position matches where playback
    // actually stopped rather than the last throttled sample.
    if (report) this.emit({ type: 'position', positionSec: this.audio.currentTime });
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async load(url: string, startAtSec: number): Promise<void> {
    this.cancelLoad();
    if (this.audio.src) {
      const previous = this.audio;
      this.stopPositionLoop(false);
      this.audio = this.createAudio();
      this.audio.volume = previous.volume;
      previous.pause();
      previous.removeAttribute('src');
      previous.load();
      this.setBuffering(false);
    }
    this.audio.src = url;
    this.audio.load();

    if (startAtSec <= 0) return;

    // Seeking before metadata arrives is ignored by the browser, so wait for
    // it. Loading and *then* seeking would play a fraction of a second from
    // zero first, which is audible and sounds like a glitch.
    await new Promise<void>((resolve, reject) => {
      const seekWhenReady = () => {
        this.audio.currentTime = startAtSec;
        resolve();
      };

      if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        seekWhenReady();
        return;
      }

      const onError = () => {
        // Resolve rather than reject: the `error` event already reported it,
        // and a rejection here would surface the same failure twice.
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(deadline);
        this.audio.removeEventListener('loadedmetadata', onLoaded);
        this.audio.removeEventListener('error', onError);
        if (this.finishLoad === cancel) this.finishLoad = null;
      };

      const cancel = () => { cleanup(); resolve(); };
      const deadline = setTimeout(() => { cleanup(); reject(new Error('The episode took too long to load')); }, 15_000);

      const onLoaded = () => {
        cleanup();
        seekWhenReady();
      };

      this.audio.addEventListener('loadedmetadata', onLoaded);
      this.audio.addEventListener('error', onError);
      this.finishLoad = cancel;
    });
  }

  async play(): Promise<void> {
    // Browsers reject this when there has been no user gesture. Letting it
    // propagate lets the machine show a real "press play" state rather than
    // silently appearing broken.
    await this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }

  seek(positionSec: number): void {
    this.audio.currentTime = positionSec;
    // Emit immediately so the UI tracks the scrub rather than waiting for the
    // next throttled sample.
    this.emit({ type: 'position', positionSec });
  }

  setRate(rate: number): void {
    this.audio.playbackRate = rate;
    // Without this, speech at 1.5× sounds like a chipmunk.
    this.audio.preservesPitch = true;
  }

  setVolume(volume: number): void {
    this.audio.volume = volume;
  }

  getPosition(): number {
    return this.audio.currentTime;
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.cancelLoad();
    this.stopPositionLoop();
    this.listeners.clear();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  /** Escape hatch for MediaSession, which needs the element itself. */
  get element(): HTMLAudioElement {
    return this.audio;
  }
}

/**
 * Media errors as something a person can act on.
 *
 * The browser gives a numeric code. "MEDIA_ERR_SRC_NOT_SUPPORTED" tells a user
 * nothing; "this episode's audio could not be loaded" at least says whose
 * problem it is.
 */
function describeMediaError(error: MediaError | null): string {
  if (!error) return 'This episode could not be played';

  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Playback was interrupted';
    case MediaError.MEDIA_ERR_NETWORK:
      return 'Lost connection while loading this episode';
    case MediaError.MEDIA_ERR_DECODE:
      return 'This episode’s audio appears to be damaged';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'The publisher’s audio could not be loaded';
    default:
      return 'This episode could not be played';
  }
}
