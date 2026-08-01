"use client";

/**
 * The engine's debug switch.
 *
 * An animation designed to be almost impossible to notice is also almost
 * impossible to *develop*, which is a problem this engine has more acutely than
 * most: the success condition is that nothing obvious is happening. Without a
 * readout there is no way to tell "the profile selector chose Cinematic
 * Breathing and it is working exactly as intended" from "the shader failed to
 * compile and you are looking at the static image underneath" — both look like
 * a still cover.
 *
 * Enabled by adding `?artwork-debug` to any URL, and only in development. It is
 * a query parameter rather than a setting because it is a tool for whoever is
 * working on the engine, not a feature.
 */
/**
 * What the render loop is actually doing.
 *
 * Distinct from the display's frame rate, and the distinction is the whole
 * point: the browser keeps calling `requestAnimationFrame` at 60Hz whatever
 * this engine does, so a counter based on that cannot tell a running animation
 * from a stopped one. These are frames the shader really drew.
 *
 * A plain mutable object rather than state — it is written every frame and read
 * once a second, and routing that through React would re-render the artwork
 * sixty times a second to display a number.
 */
export const engineStats = {
  /** Incremented once per drawn frame. */
  frames: 0,
  /** Seconds on the engine's own clock. */
  time: 0,
  /** Current amplitude, after the play/pause ramp. Zero means settled. */
  intensity: 0,
  /** Why the loop is or is not running: the gating flags, as a readable string. */
  state: "—",
  /** Renderers created. */
  mounts: 0,
  /**
   * Renderers disposed.
   *
   * Worth watching rather than obviously redundant: an engine that repeatedly
   * builds and tears down its renderer looks, from the outside, exactly like
   * one that is working — the artwork sits there and nothing moves. Comparing
   * these two numbers is the fastest way to tell those apart.
   */
  unmounts: 0,
  /** Ordered trace of lifecycle events, for working out what tore down what. */
  log: [] as string[],
};

/** Appends to the trace, newest last, bounded so it cannot grow without limit. */
export function trace(entry: string): void {
  engineStats.log.push(`${performance.now().toFixed(0)} ${entry}`);
  if (engineStats.log.length > 60) engineStats.log.shift();
}

/*
 * Mirrored onto `window` in development so the counters and the trace can be
 * read straight from a console without rendering the overlay. The overlay shows
 * a summary; when something is going wrong the *ordering* of mounts and renders
 * is what actually identifies it, and that is easier to read as a list.
 */
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __artwork?: typeof engineStats }).__artwork = engineStats;
}

/**
 * Available in production builds as well as development, deliberately.
 *
 * The engine does not behave identically in the two: React's development
 * double-invocation changes how the WebGL root is mounted and torn down, and
 * distinguishing "working exactly as designed" from "silently not running" is
 * the entire purpose of this readout. Restricting it to development would leave
 * the one environment that actually ships as the one that cannot be inspected.
 * The overlay is lazy-loaded, so nobody who does not ask for it downloads it.
 */
export function artworkDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;

  try {
    return new URLSearchParams(window.location.search).has("artwork-debug");
  } catch {
    return false;
  }
}
