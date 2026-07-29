"use client";

import { useEffect, useRef } from "react";
import { getAudio, usePlayer } from "@/lib/player/store";

/**
 * Bridges the shared <audio> element to the store, persists playback position,
 * and wires OS-level media controls.
 *
 * Renders nothing — it is mounted once in the app layout and lives for the
 * whole session so audio survives navigation.
 */

/** How often to persist position while playing. */
const SYNC_INTERVAL_MS = 10_000;

export function PlayerProvider() {
  const pendingStartRef = useRef<number>(0);
  const lastSyncedRef = useRef<number>(0);

  // --- element events -> store -------------------------------------------
  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;

    const { _sync } = usePlayer.getState();

    const onPlay = () => _sync({ isPlaying: true, error: null });
    const onPause = () => _sync({ isPlaying: false });
    const onWaiting = () => _sync({ isBuffering: true });
    const onPlaying = () => _sync({ isBuffering: false, isPlaying: true });
    const onTimeUpdate = () => _sync({ currentTime: audio.currentTime });

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
      _sync({
        isPlaying: false,
        isBuffering: false,
        error:
          "This episode wouldn't load. The publisher's server may be down, or the file may have moved.",
      });
    };

    const onEnded = () => {
      _sync({ isPlaying: false });
      const { episode, duration } = usePlayer.getState();
      if (episode) {
        void persistPosition(episode.id, duration, duration, true, "complete", episode);
      }
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("error", onError);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

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
