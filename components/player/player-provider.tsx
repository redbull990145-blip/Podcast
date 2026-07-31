"use client";

import { useEffect, useRef } from "react";
import { getAudio, usePlayer } from "@/lib/player/store";
import {
  describeMediaError,
  MEDIA_ERR,
  undecodableMessage,
  unreachableMessage,
} from "@/lib/player/playback-errors";

/**
 * Bridges the shared <audio> element to the store, persists playback position,
 * and wires OS-level media controls.
 *
 * Renders nothing — it is mounted once in the app layout and lives for the
 * whole session so audio survives navigation.
 */

/** How often to persist position while playing. */
const SYNC_INTERVAL_MS = 10_000;

/**
 * A failed media load is retried once after this delay. Publishers' CDNs drop
 * the occasional request, and a silent retry is far better than telling someone
 * their episode is broken when a second attempt would have worked.
 */
const RETRY_DELAY_MS = 700;

export function PlayerProvider() {
  const pendingStartRef = useRef<number>(0);
  const lastSyncedRef = useRef<number>(0);
  /** Episode id we have already retried, so we retry at most once per episode. */
  const retriedRef = useRef<string | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The element is replaced when playback moves between plain and CORS mode
  // for the audio enhancements; re-subscribe when that happens, or the new
  // element would drive nothing.
  const audioEpoch = usePlayer((s) => s.audioEpoch);

  // --- element events -> store -------------------------------------------
  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;

    const { _sync } = usePlayer.getState();

    const onPlay = () => _sync({ isPlaying: true, error: null });
    const onPause = () => _sync({ isPlaying: false });
    const onWaiting = () => _sync({ isBuffering: true });
    // Audio is actually flowing, so any error banner from an earlier attempt is
    // stale — and the retry budget resets for the next episode.
    const onPlaying = () => {
      retriedRef.current = null;
      _sync({ isBuffering: false, isPlaying: true, error: null });
    };
    const onTimeUpdate = () => _sync({ currentTime: audio.currentTime });

    // Authoritative position once a seek settles. If the browser clamped or
    // refused the request, this is what puts the bar back in step with the
    // audio instead of leaving it stranded at the requested time.
    const onSeeked = () => _sync({ currentTime: audio.currentTime, isBuffering: false });

    const onLoadedMetadata = () => {
      // A duration from the feed is often wrong or absent; the decoded value wins.
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        _sync({ duration: audio.duration });
      }
      // currentTime set before metadata arrived is discarded by the browser,
      // so re-apply the resume point now that seeking is possible.
      if (pendingStartRef.current > 0) {
        audio.currentTime = pendingStartRef.current;
        pendingStartRef.current = 0;
      }
      _sync({ isBuffering: false });
    };

    const onError = () => {
      const { episode } = usePlayer.getState();
      // stop() clears the source, which fires `error` by spec. Nothing is
      // loaded at that point, so there is nothing to report.
      if (!episode || !audio.getAttribute("src")) return;

      // First failure on this episode: retry once. Re-assigning src and calling
      // load() is what actually re-issues the request — setting currentTime
      // alone would not.
      if (retriedRef.current !== episode.id) {
        retriedRef.current = episode.id;
        const resumeAt = audio.currentTime || usePlayer.getState().currentTime;
        _sync({ isBuffering: true });

        retryTimerRef.current = setTimeout(() => {
          if (usePlayer.getState().episode?.id !== episode.id) return;
          pendingStartRef.current = resumeAt;
          audio.src = episode.enclosureUrl;
          audio.load();
          void audio.play().catch(() => {
            _sync({ isPlaying: false, isBuffering: false });
          });
        }, RETRY_DELAY_MS);
        return;
      }

      _sync({
        isPlaying: false,
        isBuffering: false,
        error: describeMediaError(audio.error?.code),
      });

      // "Unsupported source" is the browser's answer both to a file it cannot
      // decode and to one it never received, and those need opposite responses.
      // A no-cors probe settles it: the request is opaque, but it only resolves
      // if the host was actually reached.
      if (audio.error?.code === MEDIA_ERR.SRC_NOT_SUPPORTED) {
        const url = episode.enclosureUrl;
        void fetch(url, { mode: "no-cors", cache: "no-store" }).then(
          () => finishDiagnosis(episode.id, undecodableMessage()),
          () => finishDiagnosis(episode.id, unreachableMessage(url)),
        );
      }
    };

    /** Replaces the placeholder message, unless the listener has moved on. */
    const finishDiagnosis = (episodeId: string, message: string) => {
      const state = usePlayer.getState();
      if (state.episode?.id !== episodeId || !state.error) return;
      _sync({ error: message });
    };

    const onEnded = () => {
      _sync({ isPlaying: false });
      const { episode, duration, sleepTimer, setSleepTimer } = usePlayer.getState();
      if (!episode) return;

      void persistPosition(episode.id, duration, duration, true, "complete", episode);

      // "Stop at end of episode" means exactly that — don't roll into the next
      // one and wake the person up.
      if (sleepTimer === "episode") {
        setSleepTimer(null);
        return;
      }
      void advanceQueue(episode.id);
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("error", onError);
    audio.addEventListener("ended", onEnded);

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioEpoch]);

  // --- periodic position sync --------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      const { episode, isPlaying, currentTime, duration } = usePlayer.getState();
      if (!episode || !isPlaying) return;
      if (Math.abs(currentTime - lastSyncedRef.current) < 1) return;

      lastSyncedRef.current = currentTime;
      void persistPosition(episode.id, currentTime, duration, undefined, undefined, episode);
    }, SYNC_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // --- flush on pause and when the page goes away -------------------------
  useEffect(() => {
    // Zustand fires this on every state change; we only act on transitions that
    // matter for persistence.
    const unsubscribe = usePlayer.subscribe((state, prev) => {
      if (prev.isPlaying && !state.isPlaying && state.episode) {
        void persistPosition(
          state.episode.id,
          state.currentTime,
          state.duration,
          undefined,
          undefined,
          state.episode,
        );
      }
    });

    const flush = () => {
      const { episode, currentTime, duration } = usePlayer.getState();
      if (!episode) return;
      // sendBeacon survives the page being closed, which a fetch would not.
      const payload = JSON.stringify({
        episodeId: episode.id,
        positionSeconds: currentTime,
        durationSeconds: duration || null,
      });
      navigator.sendBeacon?.(
        "/api/playback",
        new Blob([payload], { type: "application/json" }),
      );
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  // --- sleep timer ---------------------------------------------------------
  useEffect(() => {
    // Checked on a timer rather than scheduled with setTimeout so that changing
    // or cancelling the timer never needs to unwind a pending callback, and so
    // a device that suspended past the deadline still stops on wake.
    const interval = setInterval(() => {
      const { sleepTimer, isPlaying, pause, setSleepTimer } = usePlayer.getState();
      if (typeof sleepTimer !== "number") return;
      if (Date.now() < sleepTimer) return;

      if (isPlaying) pause();
      setSleepTimer(null);
    }, 1_000);

    return () => clearInterval(interval);
  }, []);

  // --- OS media controls ---------------------------------------------------
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const unsubscribe = usePlayer.subscribe((state, prev) => {
      if (state.episode && state.episode.id !== prev.episode?.id) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: state.episode.title,
          artist: state.episode.podcastTitle,
          album: state.episode.podcastTitle,
          artwork: state.episode.artworkUrl
            ? [{ src: state.episode.artworkUrl, sizes: "512x512" }]
            : undefined,
        });
      }
      if (state.isPlaying !== prev.isPlaying) {
        navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
      }
    });

    const { play, pause, skipForward, skipBack, seek } = usePlayer.getState();
    navigator.mediaSession.setActionHandler("play", () => play());
    navigator.mediaSession.setActionHandler("pause", () => pause());
    navigator.mediaSession.setActionHandler("seekforward", () => skipForward());
    navigator.mediaSession.setActionHandler("seekbackward", () => skipBack());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime != null) seek(details.seekTime);
    });

    return () => {
      unsubscribe();
      for (const action of [
        "play",
        "pause",
        "seekforward",
        "seekbackward",
        "seekto",
      ] as const) {
        navigator.mediaSession.setActionHandler(action, null);
      }
    };
  }, []);

  return null;
}

/**
 * Plays the next queued episode once the current one finishes.
 *
 * The finished episode is removed from the queue first, so an episode played
 * straight through never lingers at the top of Up Next — a small thing that is
 * wrong in several mainstream apps.
 */
async function advanceQueue(finishedEpisodeId: string) {
  try {
    await fetch(`/api/queue?episodeId=${finishedEpisodeId}`, { method: "DELETE" });

    const res = await fetch("/api/queue");
    if (!res.ok) return;

    const { queue } = (await res.json()) as {
      queue: {
        episode: {
          id: string;
          title: string;
          enclosureUrl: string;
          durationSeconds: number | null;
          imageUrl: string | null;
          podcast: {
            id: string;
            title: string;
            artworkUrl: string | null;
            categories: string[];
          };
        };
      }[];
    };

    const next = queue[0]?.episode;
    if (!next) return;

    usePlayer.getState().load({
      id: next.id,
      title: next.title,
      enclosureUrl: next.enclosureUrl,
      durationSeconds: next.durationSeconds,
      artworkUrl: next.imageUrl ?? next.podcast.artworkUrl,
      podcastId: next.podcast.id,
      podcastTitle: next.podcast.title,
      categories: next.podcast.categories,
    });
  } catch {
    // Failing to advance just leaves the player stopped, which is recoverable.
  }
}

async function persistPosition(
  episodeId: string,
  positionSeconds: number,
  durationSeconds: number,
  played?: boolean,
  event?: "play_start" | "complete" | "skip",
  episode?: { podcastId: string; categories: string[] },
) {
  try {
    await fetch("/api/playback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        episodeId,
        positionSeconds,
        durationSeconds: durationSeconds || null,
        played,
        event,
        podcastId: episode?.podcastId,
        categories: episode?.categories,
      }),
      keepalive: true,
    });
  } catch {
    // Losing one position update is not worth surfacing; the next tick retries.
  }
}
