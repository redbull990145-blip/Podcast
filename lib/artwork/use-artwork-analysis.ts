"use client";

import { useQuery } from "@tanstack/react-query";
import { analyseArtwork, type ArtworkAnalysis } from "./analysis/analyse";
import { decodeArtwork, whenIdle } from "./analysis/decode";

/**
 * Analyses a cover, once ever.
 *
 * Two layers of caching, because they do different jobs. The module-level Map
 * is the one that matters: an analysis is a pure function of an immutable image,
 * so it can be kept for the whole session with no invalidation story at all, and
 * it can be read *synchronously*. That second property is what stops the canvas
 * flashing when someone reopens Now Playing on an episode they were already
 * playing — the renderer has its uniforms before the first frame rather than one
 * tick later.
 *
 * TanStack Query sits on top for the things a Map does not do: deduplicating
 * concurrent callers, giving React a loading state to render against, and
 * putting the result somewhere the devtools can show it.
 */

const cache = new Map<string, ArtworkAnalysis | null>();

/**
 * The analysis for a cover if it has already been computed.
 *
 * Returns undefined when nothing is cached, which is distinct from null — null
 * means the cover was analysed and could not be read.
 */
export function cachedAnalysis(src: string | null | undefined): ArtworkAnalysis | null | undefined {
  return src ? cache.get(src) : undefined;
}

async function analyse(src: string): Promise<ArtworkAnalysis | null> {
  const cached = cache.get(src);
  if (cached !== undefined) return cached;

  const rgba = await decodeArtwork(src);
  if (!rgba) {
    cache.set(src, null);
    return null;
  }

  /*
   * The arithmetic is deferred to an idle callback rather than run here.
   *
   * The whole pass is 15–20ms of straight-line work at the 256px analysis
   * resolution — nothing in isolation, and quite a lot during the frames in
   * which the Now Playing sheet is springing open, which is exactly when it
   * would otherwise land. Nothing is waiting on it: the real artwork is already
   * on screen as a plain `<Image>` and stays there until the canvas has
   * something to fade in.
   */
  const result = await new Promise<ArtworkAnalysis>((resolve) => {
    whenIdle(() => resolve(analyseArtwork(rgba)));
  });

  cache.set(src, result);
  return result;
}

export function useArtworkAnalysis(src: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["artwork-analysis", src],
    queryFn: () => analyse(src as string),
    enabled: enabled && Boolean(src),
    // An image at a URL does not change, so this is never stale and never worth
    // collecting — the underlying Map would hand back the same object anyway.
    staleTime: Infinity,
    gcTime: Infinity,
    // Decoding failed because the host blocked us or the image is gone. Neither
    // is fixed by asking again, and the caller's fallback is the static artwork
    // it was already showing.
    retry: false,
  });
}
