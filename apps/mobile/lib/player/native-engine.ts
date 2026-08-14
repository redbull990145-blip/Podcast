import {
  describeStreamError,
  eventsFromStatus,
  initialStatusMemory,
  type EngineEvent,
  type EngineListener,
  type PlaybackEngine,
  type StatusMemory,
} from '@cue/core';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';

/**
 * The Android audio engine.
 *
 * The web's counterpart wraps an `<audio>` element; this wraps an expo-audio
 * player. Both are created **outside React and never unmounted**, for the same
 * reason: React owns what is on screen, what is on screen changes on every
 * navigation, and a player owned by a component would stop mid-sentence when
 * its screen unmounted.
 *
 * `createAudioPlayer` rather than the `useAudioPlayer` hook — the hook releases
 * the player when its component unmounts, which is precisely the behaviour a
 * background podcast player must not have.
 */

/**
 * How often the native side reports status.
 *
 * Left at the platform default. Each tick crosses into JS, and the UI does not
 * need them to be smooth — the progress bar interpolates between ticks on the
 * UI thread, so this rate only has to be often enough to correct drift.
 */
const UPDATE_INTERVAL_MS = 500;

/**
 * Configure the audio session once, at module load.
 *
 * `shouldPlayInBackground` is the setting that lets audio survive the screen
 * locking. `doNotMix` is not a preference: expo-audio only associates the
 * lock-screen controls with a player whose session takes exclusive focus, so
 * without it the notification controls silently do nothing.
 */
void setAudioModeAsync({
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: 'doNotMix',
}).catch(() => {
  // A device that refuses the audio mode still plays while in the foreground.
  // Failing loudly here would take down the app over a degraded-but-usable
  // state.
});

export class NativeAudioEngine implements PlaybackEngine {
  private readonly player: AudioPlayer;
  private readonly listeners = new Set<EngineListener>();

  /**
   * The previous status, so transitions can be recovered from a stream of
   * snapshots. The comparison itself lives in `@cue/core` — its failure modes
   * (a missed `ended`, a stall reported twenty times) only show up on a device,
   * which is the worst possible place to debug them, so it is tested there
   * instead. This class holds the memory and maps field names; that is all.
   */
  private memory: StatusMemory = initialStatusMemory;

  constructor() {
    this.player = createAudioPlayer(null, { updateInterval: UPDATE_INTERVAL_MS });

    // Speech at 1.5× must not sound like a chipmunk. Set once here rather than
    // on every rate change, since it is a property of how we play, not of any
    // particular rate.
    this.player.shouldCorrectPitch = true;

    this.player.addListener('playbackStatusUpdate', (status) => {
      this.handleStatus(status);
    });
  }

  /**
   * Map expo-audio's field names onto ours, then let core decide what changed.
   *
   * The translation is deliberately the only thing here. Keeping the SDK's
   * names out of core means a rename in a future expo-audio cannot reach the
   * tested logic — it breaks in this one function instead, where the compiler
   * points straight at it.
   */
  private handleStatus(status: AudioStatus): void {
    const { events, memory } = eventsFromStatus(
      {
        isLoaded: status.isLoaded,
        isBuffering: status.isBuffering,
        isPlaying: status.playing,
        durationSec: status.duration,
        positionSec: status.currentTime,
        didJustFinish: status.didJustFinish,
        error: status.error,
      },
      this.memory,
    );

    this.memory = memory;

    for (const event of events) {
      // Errors are rewritten on the way out. Core reports the platform's own
      // string so the decision of *what* changed stays free of wording; this is
      // where it becomes something a listener can act on.
      this.emit(
        event.type === 'error'
          ? { type: 'error', message: describeStreamError(event.message) }
          : event,
      );
    }
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async load(url: string, startAtSec: number): Promise<void> {
    // A new source starts from a clean memory, or the first tick of the next
    // episode is compared against the last tick of the previous one.
    this.memory = initialStatusMemory;

    this.player.replace({ uri: url });

    if (startAtSec <= 0) return;

    // Seeking a source that has not loaded is ignored, and loading then seeking
    // would play a fraction of a second from zero first — audible, and it
    // sounds like a glitch. So wait for the load, then seek.
    await this.whenLoaded();
    await this.player.seekTo(startAtSec);
  }

  /**
   * Resolve once the source is playable.
   *
   * Times out rather than hanging: a source that never loads is a real
   * possibility on a phone that changed networks mid-request, and a promise
   * that never settles would leave the player stuck on "loading" with no way
   * back. Resolving lets play() proceed and surface the real failure.
   */
  private whenLoaded(): Promise<void> {
    if (this.player.isLoaded) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const timer = setTimeout(finish, 15_000);
      const subscription = this.player.addListener('playbackStatusUpdate', (status) => {
        if (status.isLoaded || status.error !== null) finish();
      });

      function finish(): void {
        clearTimeout(timer);
        subscription.remove();
        resolve();
      }
    });
  }

  async play(): Promise<void> {
    this.player.play();
  }

  pause(): void {
    this.player.pause();
  }

  seek(positionSec: number): void {
    // Emit immediately so the UI tracks the scrub rather than waiting for the
    // next status tick — up to half a second later, which reads as a stuck
    // scrubber that snaps.
    this.emit({ type: 'position', positionSec });
    void this.player.seekTo(positionSec);
  }

  setRate(rate: number): void {
    this.player.setPlaybackRate(rate, 'high');
  }

  setVolume(volume: number): void {
    this.player.volume = volume;
  }

  getPosition(): number {
    return this.player.currentTime;
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.listeners.clear();
    this.player.clearLockScreenControls();
    this.player.remove();
  }

  /**
   * Escape hatch for the lock screen, which needs the player itself.
   *
   * On Android this is not decoration: without an active lock-screen session
   * the OS stops a backgrounded app's audio after about three minutes, so this
   * is what makes background playback actually last.
   */
  get nativePlayer(): AudioPlayer {
    return this.player;
  }
}
