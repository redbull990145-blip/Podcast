"use client";

import { useEffect, useRef } from "react";
import type { ArtworkAnalysis } from "@/lib/artwork/analysis/analyse";
import { textureUrl } from "@/lib/artwork/analysis/decode";
import type { AnimationProfile } from "@/lib/artwork/profiles/types";
import { createArtworkRenderer } from "@/lib/artwork/engine/renderer";
import type { EngineSignal } from "@/lib/artwork/engine/signal";
import { engineStats, trace } from "@/lib/artwork/debug";

type Props = {
  src: string;
  analysis: ArtworkAnalysis;
  profile: AnimationProfile;
  /** Playback state and amplitude, read at frame time rather than through props. */
  signal: EngineSignal;
  onFirstFrame: () => void;
  onGaveUp: () => void;
};

/**
 * Mounts the renderer onto a canvas, and otherwise stays out of the way.
 *
 * The whole of this component's job is lifecycle: create the renderer when the
 * cover changes, dispose it when it goes away. Nothing per-frame passes through
 * React — time, amplitude and playback state all reach the GPU through `signal`
 * and the renderer's own loop, so this renders about once per episode.
 *
 * That is not incidental. `now-playing.tsx` goes to real trouble to keep the
 * four-times-a-second position tick away from the artwork, and an engine that
 * re-rendered React to talk to itself would have undone that work.
 */
export function ArtworkCanvas({
  src,
  analysis,
  profile,
  signal,
  onFirstFrame,
  onGaveUp,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Held in refs so a changed callback identity cannot tear the renderer down
  // and restart the texture load, which is the failure that cost the most time
  // to find in the previous implementation.
  const first = useRef(onFirstFrame);
  const gaveUp = useRef(onGaveUp);
  first.current = onFirstFrame;
  gaveUp.current = onGaveUp;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let renderer: ReturnType<typeof createArtworkRenderer> = null;

    /*
     * The image is decoded before the renderer is built, so the first frame the
     * canvas draws is a complete one. Uploading a half-decoded image would show
     * a blank or partial cover on top of the perfectly good static image
     * underneath — briefly, but visibly, and at exactly the moment somebody is
     * looking at it.
     *
     * `decode()` also moves the JPEG decode off the main thread, so it cannot
     * stall the frames the Now Playing sheet is springing open in.
     */
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.src = textureUrl(src);

    const start = async () => {
      try {
        await image.decode();
      } catch {
        // Safari has rejected `decode()` for images that then load perfectly
        // well, so a rejection waits for the load event rather than being
        // treated as a failure.
        if (!(image.complete && image.naturalWidth > 0)) {
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("artwork texture failed to load"));
          });
        }
      }

      if (cancelled) return;

      renderer = createArtworkRenderer({
        canvas,
        analysis,
        profile,
        signal,
        image,
        onFirstFrame: () => first.current(),
        onGaveUp: () => gaveUp.current(),
      });

      engineStats.mounts += 1;
      trace(renderer ? "renderer started" : "renderer unavailable");

      // No WebGL2, a failed compile, or a driver that refused a context. The
      // caller keeps showing the static artwork, which is what it was showing
      // anyway.
      if (!renderer) gaveUp.current();
    };

    void start().catch(() => {
      if (!cancelled) gaveUp.current();
    });

    return () => {
      cancelled = true;
      renderer?.dispose();
      engineStats.unmounts += 1;
      trace("renderer disposed");
    };
  }, [src, analysis, profile, signal]);

  return <canvas ref={canvasRef} className="block h-full w-full" />;
}
