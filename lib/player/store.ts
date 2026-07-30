"use client";

import { create } from "zustand";
import {
  ensureGraph,
  isGraphAttachedTo,
  resetGraph,
  setBoost,
  setSkipSilence as setSkipSilenceEngine,
  supportsCors,
  teardownGraph,
} from "./audio-graph";
import { corsVerdict, rememberCors } from "./cors-cache";

/**
 * Player state.
 *
 * The <audio> element is deliberately kept outside React: it is the source of
 * truth for time and playback status, and this store mirrors it. Trying to
 * drive an audio element from React state instead produces stutter on seek and
 * fights the browser over buffering.
 *
 * There is exactly one element for the whole app, created lazily on first play,
 * so navigating between pages never interrupts audio.
 */

export type PlayableEpisode = {
  id: string;
  title: string;
  enclosureUrl: string;
  durationSeconds: number | null;
  artworkUrl: string | null;
  podcastId: string;
  podcastTitle: string;
  categories: string[];
};

export const MIN_RATE = 0.5;
export const MAX_RATE = 3;
export const RATE_STEP = 0.05;

type PlayerState = {
  episode: PlayableEpisode | null;
  isPlaying: boolean;
  /** True between pressing play and the first frame of audio. */
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  error: string | null;
  /** Seconds jumped by the skip buttons. Overcast-style asymmetric defaults. */
  skipForwardSeconds: number;
  skipBackSeconds: number;

  // --- UI ------------------------------------------------------------------
  /** Now Playing is showing full-screen rather than just the docked bar. */
  expanded: boolean;
  /** Captions panel is open inside Now Playing. */
  captionsOpen: boolean;

  // --- sleep timer ---------------------------------------------------------
  /**
   * epoch ms at which playback stops, or "episode" to stop when this episode
   * ends. Null when no timer is running.
   */
  sleepTimer: number | "episode" | null;

  // --- audio enhancements --------------------------------------------------
  /** User's preference. Applies only where the host allows CORS. */
  skipSilence: boolean;
  /** Linear gain, 1 = untouched. */
  volumeBoost: number;
  /**
   * True when the current episode's host refused a CORS request, so the Web
   * Audio graph cannot read it. Surfaced as a note rather than an error.
   */
  enhancementsUnavailable: boolean;
  /** Bumped whenever the audio element is replaced, so the provider re-binds. */
  audioEpoch: number;
};

type PlayerActions = {
  load: (episode: PlayableEpisode, startAt?: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  skipForward: () => void;
  skipBack: () => void;
  setRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  stop: () => void;
  setExpanded: (expanded: boolean) => void;
  setCaptionsOpen: (open: boolean) => void;
  /** Minutes from now, "episode" to stop at the end of this one, or null. */
  setSleepTimer: (value: number | "episode" | null) => void;
  setSkipSeconds: (direction: "forward" | "back", seconds: number) => void;
  setSkipSilence: (enabled: boolean) => void;
  setVolumeBoost: (multiplier: number) => void;
  /**
   * Attaches the Web Audio graph to the current episode if its host permits.
   * Safe to call repeatedly; does nothing when neither enhancement is on.
   */
  applyEnhancements: () => Promise<void>;
  /** Called by the provider's event listeners — not from UI. */
  _sync: (patch: Partial<PlayerState>) => void;
};

let audioElement: HTMLAudioElement | null = null;

/**
 * The single shared audio element. Created on first use, never replaced.
 *
 * `crossOrigin` is deliberately NOT set. Setting it makes the browser issue the
 * media request in CORS mode, and a response without `Access-Control-Allow-Origin`
 * is then rejected outright — the element fires `error` and nothing plays. Most
 * of the big hosts (Anchor/Spotify, Megaphone, Libsyn) send no CORS headers on
 * audio at all, so opting in globally breaks playback for a large share of the
 * catalogue in exchange for a Web Audio graph we only want on some shows.
 *
 * Skip-silence/volume-boost instead opt in per episode via `enableCrossOrigin`
 * below, and fall back to plain playback when the host refuses.
 */
export function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audioElement) {
    audioElement = new Audio();
    audioElement.preload = "metadata";
  }
  return audioElement;
}

/**
 * Returns an element in the requested CORS mode, replacing the current one if
 * it is in the wrong mode.
 *
 * Replacement is the only way back from enhanced playback: connecting an
 * element to an AudioContext is irreversible, and such an element outputs
 * silence for any host that does not send CORS headers. Building a fresh
 * element is cheap and keeps a non-CORS show playing normally.
 *
 * Synchronous by design — it runs inside the click handler that starts
 * playback, where an await would forfeit the user gesture and get autoplay
 * blocked.
 */
function useAudioMode(wantCors: boolean): HTMLAudioElement {
  const current = getAudio()!;
  const isCors = current.crossOrigin === "anonymous";
  if (isCors === wantCors) return current;

  current.pause();
  current.removeAttribute("src");
  current.load();

  const next = new Audio();
  next.preload = "metadata";
  if (wantCors) next.crossOrigin = "anonymous";
  next.volume = current.volume;
  next.muted = current.muted;
  next.playbackRate = current.playbackRate;
  next.preservesPitch = true;

  if (!wantCors) teardownGraph();

  audioElement = next;
  // The provider binds its listeners to whichever element this counter names.
  usePlayer.setState((s) => ({ audioEpoch: s.audioEpoch + 1 }));
  return next;
}

function clampRate(rate: number) {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate / RATE_STEP) * RATE_STEP));
}

const STORAGE_KEY = "cadence-player-prefs";

/** Bumped when a stored preference needs rewriting rather than just defaulting. */
const PREFS_VERSION = 2;

/** Skip intervals offered in Settings. */
export const SKIP_CHOICES = [5, 10, 15, 30, 45, 60] as const;

function clampSkip(value: unknown, fallback: number): number {
  const seconds = Number(value);
  return SKIP_CHOICES.includes(seconds as (typeof SKIP_CHOICES)[number])
    ? seconds
    : fallback;
}

function loadPrefs(): Pick<
  PlayerState,
  | "playbackRate"
  | "volume"
  | "skipForwardSeconds"
  | "skipBackSeconds"
  | "skipSilence"
  | "volumeBoost"
> {
  const fallback = {
    playbackRate: 1,
    volume: 1,
    // Symmetric by default. Asymmetric skips (30 forward, 15 back) are an
    // ad-skipping convention; for following a conversation, having the two
    // buttons undo each other is what people actually expect.
    skipForwardSeconds: 15,
    skipBackSeconds: 15,
    skipSilence: false,
    volumeBoost: 1,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<typeof fallback> & { version?: number };

    // Anyone who used the app before the default became symmetric has 30/15
    // stored, and a stored value beats a changed default forever. Rewrite that
    // exact pair once — it is the old default, not a choice anyone made, since
    // there was no way to set these until now.
    const inheritedOldDefault =
      (parsed.version ?? 1) < 2 &&
      Number(parsed.skipForwardSeconds) === 30 &&
      Number(parsed.skipBackSeconds) === 15;

    return {
      playbackRate: clampRate(Number(parsed.playbackRate) || 1),
      volume: Math.min(1, Math.max(0, Number(parsed.volume ?? 1))),
      skipForwardSeconds: inheritedOldDefault
        ? 15
        : clampSkip(parsed.skipForwardSeconds, 15),
      skipBackSeconds: clampSkip(parsed.skipBackSeconds, 15),
      skipSilence: parsed.skipSilence === true,
      volumeBoost: Math.min(3, Math.max(1, Number(parsed.volumeBoost) || 1)),
    };
  } catch {
    return fallback;
  }
}

function savePrefs(state: PlayerState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        // Stamped so the 30/15 migration in loadPrefs runs at most once, and a
        // deliberate 30s forward chosen from Settings afterwards sticks.
        version: PREFS_VERSION,
        playbackRate: state.playbackRate,
        volume: state.volume,
        skipForwardSeconds: state.skipForwardSeconds,
        skipBackSeconds: state.skipBackSeconds,
        skipSilence: state.skipSilence,
        volumeBoost: state.volumeBoost,
      }),
    );
  } catch {
    // Storage can be full or blocked; preferences are not worth failing over.
  }
}

export const usePlayer = create<PlayerState & PlayerActions>((set, get) => ({
  episode: null,
  isPlaying: false,
  isBuffering: false,
  currentTime: 0,
  duration: 0,
  error: null,
  muted: false,
  expanded: false,
  captionsOpen: false,
  sleepTimer: null,
  enhancementsUnavailable: false,
  audioEpoch: 0,
  ...loadPrefs(),

  load(episode, startAt = 0) {
    if (typeof window === "undefined") return;

    const { skipSilence, volumeBoost } = get();
    const wantsEnhancements = skipSilence || volumeBoost > 1;
    // Only enhance a host already known to allow CORS. An unknown host plays
    // plain now and is probed below, so it can be enhanced from next time.
    const enhanced = wantsEnhancements && corsVerdict(episode.enclosureUrl) === true;

    const audio = useAudioMode(enhanced);

    const isSameEpisode = get().episode?.id === episode.id;
    if (!isSameEpisode || !audio.getAttribute("src")) {
      audio.src = episode.enclosureUrl;
      audio.load();
    }

    // Setting currentTime before metadata has loaded is ignored by the browser,
    // so the provider re-applies it on loadedmetadata.
    if (startAt > 0) audio.currentTime = startAt;

    audio.playbackRate = get().playbackRate;
    // Without this, speeding up a voice makes it chipmunky.
    audio.preservesPitch = true;
    audio.volume = get().volume;
    audio.muted = get().muted;

    set({
      episode,
      currentTime: startAt,
      duration: episode.durationSeconds ?? 0,
      error: null,
      isBuffering: true,
      enhancementsUnavailable: false,
      // A new episode invalidates whatever the sleep timer was counting down to
      // only in the end-of-episode case; a wall-clock timer keeps running.
      sleepTimer: get().sleepTimer === "episode" ? null : get().sleepTimer,
    });

    void audio.play().catch(() => {
      // Autoplay policy blocks playback that isn't user-initiated. Land in a
      // paused-but-loaded state so the play button works on the next tap.
      set({ isPlaying: false, isBuffering: false });
    });

    if (enhanced) {
      const graph = ensureGraph(audio);
      if (graph) {
        setBoost(volumeBoost);
        setSkipSilenceEngine(skipSilence, () => usePlayer.getState().playbackRate);
      } else {
        set({ enhancementsUnavailable: true });
      }
    }

    // Learn this host's CORS behaviour for next time, without holding up play.
    if (wantsEnhancements && corsVerdict(episode.enclosureUrl) === undefined) {
      void supportsCors(episode.enclosureUrl).then((allowed) => {
        rememberCors(episode.enclosureUrl, allowed);
        if (!allowed && usePlayer.getState().episode?.id === episode.id) {
          set({ enhancementsUnavailable: true });
        }
      });
    }
  },

  play() {
    const audio = getAudio();
    if (!audio || !get().episode) return;
    void audio.play().catch(() => set({ isPlaying: false, isBuffering: false }));
  },

  pause() {
    getAudio()?.pause();
  },

  toggle() {
    get().isPlaying ? get().pause() : get().play();
  },

  seek(seconds) {
    const audio = getAudio();
    if (!audio) return;

    // The decoded duration is authoritative. Feed durations are frequently
    // wrong, and clamping a valid seek against a too-short feed value would
    // silently drop the request.
    const decoded = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : 0;
    const duration = decoded || get().duration || 0;
    const target = Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds);

    audio.currentTime = target;

    // Optimistic, then reconciled: the `seeked`/`timeupdate` handlers publish
    // whatever position the element actually reached, so a seek the browser
    // refuses (an unseekable stream) corrects itself rather than leaving the
    // bar parked somewhere the audio never went.
    set({ currentTime: target, isBuffering: !audio.paused });
  },

  skipForward() {
    get().seek(get().currentTime + get().skipForwardSeconds);
  },

  skipBack() {
    get().seek(get().currentTime - get().skipBackSeconds);
  },

  setRate(rate) {
    const playbackRate = clampRate(rate);
    const audio = getAudio();
    if (audio) {
      audio.playbackRate = playbackRate;
      // Without this, speeding up a voice makes it chipmunky. Every current
      // browser supports it, but it defaults to on only in some.
      audio.preservesPitch = true;
    }
    set({ playbackRate });
    savePrefs(get());
  },

  setVolume(volume) {
    const clamped = Math.min(1, Math.max(0, volume));
    const audio = getAudio();
    if (audio) {
      audio.volume = clamped;
      audio.muted = false;
    }
    set({ volume: clamped, muted: false });
    savePrefs(get());
  },

  toggleMute() {
    const audio = getAudio();
    const muted = !get().muted;
    if (audio) audio.muted = muted;
    set({ muted });
  },

  stop() {
    const audio = getAudio();
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      // Clearing the source makes the element fire `error`; the provider ignores
      // that event while no episode is loaded so no banner flashes on close.
      audio.load();
    }
    set({
      episode: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      error: null,
      expanded: false,
      captionsOpen: false,
      sleepTimer: null,
    });
  },

  setExpanded(expanded) {
    set({ expanded, captionsOpen: expanded ? get().captionsOpen : false });
  },

  setCaptionsOpen(captionsOpen) {
    set({ captionsOpen });
  },

  setSleepTimer(value) {
    set({
      sleepTimer:
        typeof value === "number" ? Date.now() + value * 60_000 : value,
    });
  },

  setSkipSeconds(direction, seconds) {
    const value = clampSkip(seconds, direction === "forward" ? 15 : 15);
    set(
      direction === "forward"
        ? { skipForwardSeconds: value }
        : { skipBackSeconds: value },
    );
    savePrefs(get());
  },

  setSkipSilence(skipSilence) {
    set({ skipSilence });
    savePrefs(get());
    void get().applyEnhancements();
  },

  setVolumeBoost(multiplier) {
    const volumeBoost = Math.min(3, Math.max(1, multiplier));
    set({ volumeBoost });
    savePrefs(get());
    void get().applyEnhancements();
  },

  async applyEnhancements() {
    const audio = getAudio();
    const { episode, skipSilence, volumeBoost, playbackRate } = get();
    if (!audio || !episode) return;

    const wanted = skipSilence || volumeBoost > 1;

    // Turning them off mid-episode only needs the processing neutralised. The
    // element stays in CORS mode until the next load, which is harmless.
    if (!wanted) {
      resetGraph(playbackRate);
      set({ enhancementsUnavailable: false });
      return;
    }

    // Already routed through the graph — just update the parameters.
    if (isGraphAttachedTo(audio)) {
      setBoost(volumeBoost);
      setSkipSilenceEngine(skipSilence, () => usePlayer.getState().playbackRate);
      return;
    }

    let allowed = corsVerdict(episode.enclosureUrl);
    if (allowed === undefined) {
      allowed = await supportsCors(episode.enclosureUrl);
      rememberCors(episode.enclosureUrl, allowed);
    }

    if (!allowed) {
      set({ enhancementsUnavailable: true });
      return;
    }

    // Swap to a CORS element and pick playback back up where it was. This is
    // not inside a user gesture, but audio is already playing, which every
    // current browser accepts as continuing rather than starting.
    const resumeAt = audio.currentTime;
    const wasPlaying = !audio.paused;

    const next = useAudioMode(true);
    next.src = episode.enclosureUrl;
    next.load();
    next.currentTime = resumeAt;

    if (!ensureGraph(next)) {
      set({ enhancementsUnavailable: true });
      return;
    }

    set({ enhancementsUnavailable: false });
    setBoost(volumeBoost);
    setSkipSilenceEngine(skipSilence, () => usePlayer.getState().playbackRate);

    if (wasPlaying) {
      void next.play().catch(() => set({ isPlaying: false, isBuffering: false }));
    }
  },

  _sync(patch) {
    set(patch);
  },
}));
