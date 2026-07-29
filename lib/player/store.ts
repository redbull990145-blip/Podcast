"use client";

import { create } from "zustand";

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

function clampRate(rate: number) {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate / RATE_STEP) * RATE_STEP));
}

const STORAGE_KEY = "cadence-player-prefs";

function loadPrefs(): Pick<
  PlayerState,
  "playbackRate" | "volume" | "skipForwardSeconds" | "skipBackSeconds"
> {
  const fallback = {
    playbackRate: 1,
    volume: 1,
    skipForwardSeconds: 30,
    skipBackSeconds: 15,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<typeof fallback>;
    return {
      playbackRate: clampRate(Number(parsed.playbackRate) || 1),
      volume: Math.min(1, Math.max(0, Number(parsed.volume ?? 1))),
      skipForwardSeconds: Number(parsed.skipForwardSeconds) || 30,
      skipBackSeconds: Number(parsed.skipBackSeconds) || 15,
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
        playbackRate: state.playbackRate,
        volume: state.volume,
        skipForwardSeconds: state.skipForwardSeconds,
        skipBackSeconds: state.skipBackSeconds,
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
  ...loadPrefs(),

  load(episode, startAt = 0) {
    const audio = getAudio();
    if (!audio) return;

    const isSameEpisode = get().episode?.id === episode.id;
    if (!isSameEpisode) {
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
      // A new episode invalidates whatever the sleep timer was counting down to
      // only in the end-of-episode case; a wall-clock timer keeps running.
      sleepTimer: get().sleepTimer === "episode" ? null : get().sleepTimer,
    });

    void audio.play().catch(() => {
      // Autoplay policy blocks playback that isn't user-initiated. Land in a
      // paused-but-loaded state so the play button works on the next tap.
      set({ isPlaying: false, isBuffering: false });
    });
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
    const duration = get().duration || audio.duration || 0;
    const target = Math.min(Math.max(0, seconds), duration || seconds);
    audio.currentTime = target;
    set({ currentTime: target });
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

  _sync(patch) {
    set(patch);
  },
}));
