"use client";

/**
 * The WebGL2 renderer.
 *
 * This began as React Three Fiber and is not, and the reason is worth recording
 * because it was not a preference.
 *
 * R3F renders `<Canvas>`'s children into a *separate* reconciler root, from a
 * layout effect with no dependency array, behind an awaited async `configure()`.
 * The practical consequence, measured directly with a mount/unmount trace: every
 * render of the host mounted the scene and unmounted it again 2–7ms later,
 * repeatedly and without ever settling. That cancelled the texture load each
 * time, so the engine never drew a frame. It survived memoising the host,
 * making every prop referentially stable, moving playback state to a
 * subscription, and disabling React StrictMode — the mount/unmount pairs
 * continued regardless.
 *
 * What this replaced it with is one file with no framework in it: a context, a
 * program, a quad and two textures. It is a few hundred lines against roughly
 * 229 KB gzipped of library, for a scene that is one textured rectangle and was
 * never going to use a scene graph, a camera, raycasting or a render loop it did
 * not control. The engine's own architecture always kept the host thin so this
 * swap would be contained: nothing in `analysis/`, `profiles/` or `shaders/`
 * changed to make it, and the shaders are the same GLSL.
 *
 * Deliberately free of React. It is constructed, fed and disposed by
 * `components/artwork/artwork-canvas.tsx`, and everything time-varying is
 * pushed in through `signal` and `update()`.
 */

import type { ArtworkAnalysis } from "../analysis/analyse";
import { composeFragment, VERTEX_GLSL } from "../shaders/compose";
import { modulesFor } from "../shaders/modules";
import { createUniforms, maxDeltaFor, type ArtworkUniforms } from "../shaders/uniforms";
import type { AnimationProfile } from "../profiles/types";
import { createClock, createRamp } from "./clock";
import {
  createQualityMonitor,
  dprFor,
  QUALITY,
  type QualityLevel,
} from "./quality";
import type { EngineSignal } from "./signal";
import { engineStats } from "../debug";

export type RendererOptions = {
  canvas: HTMLCanvasElement;
  analysis: ArtworkAnalysis;
  profile: AnimationProfile;
  signal: EngineSignal;
  /** The already-decoded artwork, ready to upload. */
  image: TexImageSource;
  /** Called once, after the first frame has actually reached the framebuffer. */
  onFirstFrame: () => void;
  /** Called if the renderer gives up on this device. */
  onGaveUp: () => void;
};

export type ArtworkRenderer = {
  /** Starts the loop if there is anything to draw. Safe to call repeatedly. */
  wake: () => void;
  /** Releases the context and every GPU resource. */
  dispose: () => void;
};

/**
 * A single quad in clip space.
 *
 * Two triangles rather than a triangle strip: the difference is one vertex and
 * strips complicate nothing else here, while a plain triangle list is what every
 * debugger and profiler expects to see.
 */
const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

export function createArtworkRenderer(options: RendererOptions): ArtworkRenderer | null {
  const { canvas, analysis, profile, signal, image, onFirstFrame, onGaveUp } = options;

  const context = canvas.getContext("webgl2", {
    // One quad with no geometry edges to alias, no depth, no stencil, and an
    // opaque result. Each of these is a real cost on a phone for something the
    // shader cannot use.
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
    // The engine never reads the framebuffer back, and preserving it forces the
    // driver to keep a second copy.
    preserveDrawingBuffer: false,
  });

  if (!context) return null;

  // Rebound after the guard rather than narrowed in place: the render loop below
  // is a hoisted function declaration, and TypeScript drops narrowing inside
  // those because they could in principle be called before it happened.
  const gl = context;

  const modules = modulesFor(profile.modules.map(([id]) => id));
  const weights = profile.modules.map(([, weight]) => weight);

  const program = buildProgram(gl, VERTEX_GLSL, composeFragment(modules));
  if (!program) return null;

  // --- geometry -------------------------------------------------------------

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);

  const position = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  // --- textures -------------------------------------------------------------

  const artwork = createArtworkTexture(gl, image);
  const mask = createMaskTexture(gl, analysis);

  // --- uniforms -------------------------------------------------------------

  const uniforms = createUniforms(analysis.swatches, analysis.features, weights);
  const locations = new Map<string, WebGLUniformLocation | null>();
  for (const name of Object.keys(uniforms)) {
    locations.set(name, gl.getUniformLocation(program, name));
  }

  gl.useProgram(program);
  gl.uniform1i(locations.get("uMap") ?? null, 0);
  gl.uniform1i(locations.get("uMask") ?? null, 1);
  uploadStatic(gl, locations, uniforms);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, artwork);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, mask);

  // --- sizing ---------------------------------------------------------------

  let quality: QualityLevel = QUALITY.FULL;
  let width = 0;
  let height = 0;

  const resize = () => {
    const dpr = dprFor(quality, window.devicePixelRatio || 1);
    const next = {
      width: Math.max(1, Math.round(canvas.clientWidth * dpr)),
      height: Math.max(1, Math.round(canvas.clientHeight * dpr)),
    };
    if (next.width === width && next.height === height) return;

    width = next.width;
    height = next.height;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // --- loop -----------------------------------------------------------------

  const clock = createClock();
  const ramp = createRamp(0);
  const monitor = createQualityMonitor();

  let frame = 0;
  let last = 0;
  let drawn = false;
  let disposed = false;
  let lost = false;

  const onContextLost = (event: Event) => {
    // Preventing the default is what makes restoration possible at all, but this
    // engine does not attempt it: the caller falls back to the static artwork,
    // which is what it was showing underneath the whole time.
    event.preventDefault();
    lost = true;
    stop();
    onGaveUp();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function tick(now: number) {
    frame = 0;
    if (disposed || lost) return;

    const delta = last === 0 ? 1 / 60 : (now - last) / 1000;
    last = now;

    const settings = signal.current;
    const time = clock.advance(delta);
    const amplitude = ramp.step(settings.playing ? settings.intensity : 0, delta);

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform1f(locations.get("uTime") ?? null, time);
    gl.uniform1f(locations.get("uIntensity") ?? null, amplitude);
    gl.uniform1f(locations.get("uMaxDelta") ?? null, maxDeltaFor(amplitude));
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    engineStats.frames += 1;
    engineStats.time = time;
    engineStats.intensity = amplitude;

    if (!drawn) {
      drawn = true;
      onFirstFrame();
    }

    const next = monitor.record(delta);
    if (next !== quality) {
      quality = next;
      if (quality === QUALITY.DISABLED) {
        stop();
        onGaveUp();
        return;
      }
      resize();
    }

    /*
     * The loop stops when a paused animation has settled.
     *
     * Not a micro-optimisation: a continuous loop that merely skipped its work
     * would still wake the GPU sixty times a second for a picture that is not
     * changing. Stopping is what makes the engine free while an episode is
     * paused, and `wake()` is how it comes back.
     */
    if (!settings.playing && amplitude === 0) return;

    frame = requestAnimationFrame(tick);
  }

  function wake() {
    if (disposed || lost || frame) return;
    // Reset rather than carry the gap: `last` is stale by however long the loop
    // was stopped, and the clock would otherwise take one enormous step.
    last = 0;
    frame = requestAnimationFrame(tick);
  }

  const unsubscribe = signal.subscribe(wake);
  wake();

  return {
    wake,
    dispose() {
      disposed = true;
      stop();
      unsubscribe();
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);

      gl.deleteTexture(artwork);
      gl.deleteTexture(mask);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);

      /*
       * The context is deliberately *not* lost here.
       *
       * An earlier version called `WEBGL_lose_context.loseContext()` to free the
       * backing surface promptly. That is correct only if the canvas element is
       * also going away — and here it is not: the same `<canvas>` is reused
       * whenever the cover or the profile changes. Once a context has been lost
       * this way, `getContext('webgl2')` on that canvas returns *the same lost
       * context* rather than a fresh one, so every subsequent renderer failed to
       * build and the engine disabled itself permanently after the first switch.
       *
       * Releasing only the resources leaves the context healthy for the next
       * renderer to adopt, which also removes the cost of recreating it. The
       * surface is reclaimed when the canvas is collected.
       */
    },
  };
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function buildProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);

  // The shaders are attached to the program, so deleting the objects here only
  // drops this reference — the linked program keeps what it needs.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[artwork] shader link failed", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // Reported with line numbers, because a composed shader's error line means
    // nothing without the assembled source in front of you.
    const log = gl.getShaderInfoLog(shader);
    const numbered = source
      .split("\n")
      .map((line, i) => `${String(i + 1).padStart(3)} ${line}`)
      .join("\n");
    console.warn(`[artwork] shader compile failed: ${log}\n${numbered}`);
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

/**
 * Uploads the artwork, with a mip chain.
 *
 * The mipmaps are not an optimisation — they are the blur pyramid. The glow and
 * depth modules read high levels of this chain with `textureLod`, which is what
 * lets the entire engine be one draw call with no render targets and no second
 * pass. See `shaders/lib/noise.ts` and the two-band recombination in
 * `compose.ts`.
 */
function createArtworkTexture(
  gl: WebGL2RenderingContext,
  image: TexImageSource,
): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);

  // No UNPACK_FLIP_Y: the vertex shader flips instead, so this texture and the
  // protection mask share one orientation. See VERTEX_GLSL.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // Clamped rather than repeated: a drifting light field samples slightly beyond
  // the edge, and wrapping would bring the opposite side of the cover into view.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return texture;
}

/** The protection mask: one channel, 64×64, 4 KB. */
function createMaskTexture(
  gl: WebGL2RenderingContext,
  analysis: ArtworkAnalysis,
): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);

  // A 64-byte row is not a multiple of the default 4-byte unpack alignment in
  // the general case, and getting this wrong skews the mask diagonally.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R8,
    analysis.maskSize,
    analysis.maskSize,
    0,
    gl.RED,
    gl.UNSIGNED_BYTE,
    analysis.mask,
  );

  // Linear, so the boundary between moving and still regions is interpolated
  // rather than stepped — a 64-cell grid sampled with nearest filtering puts
  // visible square edges into the motion field.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return texture;
}

/** Uploads everything that never changes for the lifetime of the renderer. */
function uploadStatic(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation | null>,
  uniforms: ArtworkUniforms,
): void {
  const vec3 = (name: keyof ArtworkUniforms) =>
    gl.uniform3fv(
      locations.get(name) ?? null,
      uniforms[name].value as [number, number, number],
    );

  vec3("uVibrant");
  vec3("uDominant");
  vec3("uMuted");
  vec3("uDark");
  vec3("uLight");

  gl.uniform2fv(locations.get("uSubject") ?? null, uniforms.uSubject.value);
  gl.uniform1f(locations.get("uMaxLod") ?? null, uniforms.uMaxLod.value);
  gl.uniform1f(locations.get("uDepthLod") ?? null, uniforms.uDepthLod.value);
  gl.uniform1fv(locations.get("uWeights") ?? null, uniforms.uWeights.value);
}
