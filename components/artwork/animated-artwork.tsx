"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useArtworkAnalysis } from "@/lib/artwork/use-artwork-analysis";
import { artworkDebugEnabled } from "@/lib/artwork/debug";
import { createEngineSignal } from "@/lib/artwork/engine/signal";
import { selectProfile, type Selection } from "@/lib/artwork/profiles/select";
import { INTENSITY_SCALE, type Intensity, type ProfileId } from "@/lib/artwork/types";
import { usePrefs } from "@/lib/prefs/store";
import { cn } from "@/lib/utils";

/**
 * The renderer lands in its own chunk, fetched the first time this component
 * decides it is going to animate something. Nobody who never opens Now Playing
 * pays for it, and it is never part of the server render.
 */
const ArtworkCanvas = dynamic(
  () => import("./artwork-canvas").then((m) => m.ArtworkCanvas),
  { ssr: false },
);

/** Development only, and only with `?artwork-debug` in the URL. */
const ArtworkDebug = dynamic(
  () => import("./artwork-debug").then((m) => m.ArtworkDebug),
  { ssr: false },
);

export type AnimatedArtworkProps = {
  src: string | null | undefined;
  alt: string;
  /** The artwork is alive while the episode is playing, and settles when it stops. */
  playing: boolean;
  /** Overrides the user's setting for this instance. */
  intensity?: Intensity;
  /** Forces a profile, bypassing selection. For the debug gallery. */
  profile?: ProfileId;
  /** Applied to the wrapper. Give it the size, aspect ratio and corner radius. */
  className?: string;
  /** Passed to the underlying `<Image>` — this is a real Next image, not a placeholder. */
  sizes?: string;
  priority?: boolean;
  /** Reports what was chosen and why. For the debug overlay. */
  onSelection?: (selection: Selection) => void;
};

/**
 * Artwork that is subtly alive while an episode is playing.
 *
 * The structure is the whole safety argument, so it is worth stating plainly:
 * **the real artwork is always rendered, as an ordinary `next/image`, and is
 * never removed.** The canvas is layered on top and fades in only once it has
 * drawn a frame it is happy with.
 *
 * Everything that could go wrong therefore degrades to "the artwork looks
 * exactly as it does today":
 *
 *   - no WebGL2, or a blacklisted driver — the canvas never appears
 *   - the analysis fails, or the host blocks the image — never appears
 *   - the shader fails to compile — never appears
 *   - the device cannot hold the frame rate — it fades back out
 *   - reduced motion, or the setting is off — never mounted at all
 *   - JavaScript disabled — the `<Image>` is server-rendered as usual
 *
 * There is no state in which this component shows something worse than the plain
 * image would have, and no state in which it shifts the layout.
 */
export function AnimatedArtwork({
  src,
  alt,
  playing,
  intensity,
  profile,
  className,
  sizes,
  priority,
  onSelection,
}: AnimatedArtworkProps) {
  const reducedMotion = useReducedMotion();
  const preference = usePrefs((s) => s.artworkMotion);

  const [gaveUp, setGaveUp] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [debug, setDebug] = useState(false);

  // Read after mount rather than during render: the URL is not available on the
  // server, and deciding this during the first client render would disagree
  // with the server's HTML.
  useEffect(() => setDebug(artworkDebugEnabled()), []);

  const setting = intensity ?? preference;
  const scale = INTENSITY_SCALE[setting];

  const enabled =
    Boolean(src) && !reducedMotion && scale > 0 && !gaveUp && supportsWebGL2();

  const { data: analysis } = useArtworkAnalysis(src, enabled);

  const selection = useMemo(() => {
    if (!analysis || !src) return null;
    return selectProfile(analysis.features, src, {
      override: profile,
      motionDisabled: reducedMotion === true,
    });
  }, [analysis, src, profile, reducedMotion]);

  useEffect(() => {
    if (selection) onSelection?.(selection);
  }, [selection, onSelection]);

  /*
   * A new episode means a new analysis, and until it arrives the canvas is
   * still showing the previous cover. Fading it out on `src` rather than
   * waiting for the new analysis keeps the handover clean — otherwise the old
   * artwork would sit visibly on top of the new one for as long as the decode
   * takes.
   */
  useEffect(() => {
    setDrawn(false);
    setGaveUp(false);
  }, [src]);

  /*
   * Playback state and amplitude reach the renderer through this rather than as
   * props. Now Playing re-renders whenever buffering or playback state changes,
   * and the renderer must not be torn down and rebuilt for any of that — it
   * would restart the texture load every time. See .
   */
  const [signal] = useState(() => createEngineSignal({ playing, intensity: scale }));

  useEffect(() => {
    signal.set({ playing, intensity: scale });
  }, [signal, playing, scale]);

  const onFirstFrame = useCallback(() => setDrawn(true), []);
  const onGaveUp = useCallback(() => {
    setGaveUp(true);
    setDrawn(false);
  }, []);

  // The profile with no modules renders nothing, so there is no reason to hold
  // a WebGL context open for it.
  const animating =
    enabled && Boolean(analysis) && selection !== null && selection.profile.modules.length > 0;

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          width={640}
          height={640}
          sizes={sizes}
          priority={priority}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="h-full w-full bg-white/10" />
      )}

      {animating && analysis && selection && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 transition-opacity duration-[var(--duration-slow)] ease-out",
            drawn ? "opacity-100" : "opacity-0",
          )}
        >
          <ArtworkCanvas
            src={src as string}
            analysis={analysis}
            profile={selection.profile}
            signal={signal}
            onFirstFrame={onFirstFrame}
            onGaveUp={onGaveUp}
          />
        </div>
      )}

      {debug && <ArtworkDebug selection={selection} analysis={analysis ?? null} />}
    </div>
  );
}

/**
 * Whether this browser can run the engine at all.
 *
 * WebGL2 specifically, not WebGL. The shaders are GLSL ES 3.00 because
 * fragment-stage `textureLod` is core there — and that one function is what
 * lets the glow and depth modules read the mip chain as a blur pyramid, which
 * is what keeps the whole engine to a single pass with no render targets. On
 * WebGL1 it is an extension that may or may not exist, and building a second
 * rendering path for a few percent of browsers to get a worse version of the
 * effect is not a trade worth making when the alternative is the artwork they
 * already see.
 *
 * Cached because it costs a context creation, and the answer cannot change.
 */
let webgl2: boolean | null = null;

function supportsWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  if (webgl2 !== null) return webgl2;

  try {
    const probe = document.createElement("canvas");
    const context = probe.getContext("webgl2");
    webgl2 = context !== null;

    // Probe contexts count against the browser's limit like any other, and this
    // one has served its purpose.
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl2 = false;
  }

  return webgl2;
}
