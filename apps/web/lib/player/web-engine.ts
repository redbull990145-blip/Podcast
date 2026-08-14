import type { EngineEvent, EngineListener, PlaybackEngine } from '@cue/core';

/**
 * The web audio engine.
 *
 * The `<audio>` element is created **outside React and never unmounted**. That
 * is the whole point: React owns what is on screen, and what is on screen
 * changes on every navigation. An element owned by a component would be torn
 * down and recreated by a route change, and playback would stop mid-sentence
 * — the single most unforgivable bug a podcast app can have.
 *
 * So the element lives in a module singleton, the machine talks to it through
 * the `PlaybackEngine` interface, and React only ever reads state.
 */
export class WebAudioEngine implements PlaybackEngine {
  private readonly audio: HTMLAudioElement;
  private readonly listeners = new Set<EngineListener>();
  private rafId: number | null = null;

  constructor() {
    this.audio = new Audio();

    // Podcast audio is large and streamed; `metadata` gets duration without
    // pulling the whole file before the user has pressed play.
    this.audio.preload = 'metadata';
    // Publisher CDNs vary wildly in CORS support. Leaving this unset keeps
    // plain playback working everywhere — it is only setting `crossOrigin`
    // that makes a non-CORS host fail outright.
    this.audio.crossOrigin = null;

    this.audio.addEventListener('loadedmetadata', () => {
      this.emit({
        type: 'loaded',
        // Live streams report Infinity; that is "unknown", not a duration.
        durationSec: Number.isFinite(this.audio.duration) ? this.audio.duration : null,
      });
    });

    this.audio.addEventListener('play', () => {
      this.emit({ type: 'playing' });
      this.startPositionLoop();
    });

    this.audio.addEventListener('pause', () => {
      this.emit({ type: 'paused' });
      this.stopPositionLoop();
    });

    this.audio.addEventListener('ended', () => {
      this.emit({ type: 'ended' });
      this.stopPositionLoop();
    });

    this.audio.addEventListener('waiting', () => {
      this.emit({ type: 'stalled' });
    });

    this.audio.addEventListener('error', () => {
      this.emit({ type: 'error', message: describeMediaError(this.audio.error) });
      this.stopPositionLoop();
    });
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
    if (this.rafId !== null) return;

    let lastEmit = 0;

    const tick = (timestamp: number) => {
      if (timestamp - lastEmit >= 250) {
        lastEmit = timestamp;
        this.emit({ type: 'position', positionSec: this.audio.currentTime });
      }
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private stopPositionLoop(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
    // One final reading, so the stored position matches where playback
    // actually stopped rather than the last throttled sample.
    this.emit({ type: 'position', positionSec: this.audio.currentTime });
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async load(url: string, startAtSec: number): Promise<void> {
    this.audio.src = url;
    this.audio.load();

    if (startAtSec <= 0) return;

    // Seeking before metadata arrives is ignored by the browser, so wait for
    // it. Loading and *then* seeking would play a fraction of a second from
    // zero first, which is audible and sounds like a glitch.
    await new Promise<void>((resolve) => {
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
        this.audio.removeEventListener('loadedmetadata', onLoaded);
        this.audio.removeEventListener('error', onError);
      };

      const onLoaded = () => {
        cleanup();
        seekWhenReady();
      };

      this.audio.addEventListener('loadedmetadata', onLoaded);
      this.audio.addEventListener('error', onError);
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
