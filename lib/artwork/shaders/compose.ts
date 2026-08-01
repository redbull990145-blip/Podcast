/**
 * Builds a fragment shader out of the modules a profile asked for.
 *
 * The alternative — one shader per profile — was rejected early. Fifteen
 * profiles would mean fifteen files repeating the same Oklab conversion, the
 * same mask lookup and the same fidelity clamp, and the first time one of those
 * shared parts needed changing it would need changing fifteen times, with
 * nothing to catch the copy that got missed. Worse, adding a profile would be a
 * shader-authoring job rather than a data change, which is the opposite of
 * "support future animation profiles".
 *
 * So a profile is a list of module ids and a set of weights, and this file
 * assembles the corresponding shader. Modules whose weight would be zero are
 * not compiled in at all — there is no dead arithmetic in the resulting
 * program, only the effects actually in use.
 *
 * **Program reuse comes free.** Three keys its internal program cache on the
 * shader source, so two materials built from the same module set share one
 * compiled program without this file doing anything about it. Profiles overlap
 * heavily in their modules, so a real session compiles a handful of programs
 * rather than one per show.
 */

import { MAX_MODULES, type ModuleId } from "../types";
import { FIDELITY_GLSL } from "./lib/fidelity";
import { NOISE_GLSL } from "./lib/noise";
import { OKLAB_GLSL } from "./lib/oklab";

/**
 * One effect.
 *
 * A module contributes GLSL to one or both of two stages, and is written
 * against a small fixed vocabulary rather than against the whole shader:
 *
 * | name      | meaning                                                      |
 * | --------- | ------------------------------------------------------------ |
 * | `W`       | this module's weight, already scaled by intensity and by the pause ramp |
 * | `uv`      | the fragment's texture coordinate                             |
 * | `time`    | seconds, from a clock that never repeats — see `engine/clock.ts` |
 * | `freedom` | `1 - protect`: 1 where the artwork may move, 0 over text and faces |
 * | `offset`  | *(displace stage)* accumulated displacement, in UV units      |
 * | `lab`     | *(tone stage)* the working colour in Oklab                    |
 * | `srcLab`  | *(tone stage)* the untouched source colour in Oklab           |
 *
 * Keeping the vocabulary this narrow is what makes the hard rules checkable by
 * reading a module: a module with no `displace` string cannot move a pixel,
 * because there is no name in scope through which it could.
 */
export type ShaderModule = {
  id: ModuleId;
  /** Accumulates into `offset`. Must multiply by `freedom` — see `assertMasked`. */
  displace?: string;
  /** Reads and rewrites `lab`. */
  tone?: string;
};

/**
 * Shared uniforms.
 *
 * Declared once for every shader rather than per module. Unused ones cost
 * nothing: the GLSL compiler strips them and three only uploads uniforms the
 * linked program actually reports, so a shader that never reads `uSubject`
 * never receives it.
 */
const UNIFORMS_GLSL = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uMask;

uniform float uTime;
/** Global amplitude: user intensity times the play/pause ramp. Zero means identity. */
uniform float uIntensity;
/** Oklab deviation budget. Scales with intensity, so at zero nothing may change. */
uniform float uMaxDelta;
/** Per-module weights, in the order the profile listed them. */
uniform float uWeights[${MAX_MODULES}];

/** The cover's own colours, pre-converted to Oklab on the CPU. */
uniform vec3 uVibrant;
uniform vec3 uDominant;
uniform vec3 uMuted;
uniform vec3 uDark;
uniform vec3 uLight;

/** Saliency-weighted centre of the artwork, for modules that place light relative to the subject. */
uniform vec2 uSubject;
/** Highest mip level available, so blur-based modules can ask for the widest one. */
uniform float uMaxLod;
/** Mip level separating the "background" band from the detail band. See main(). */
uniform float uDepthLod;
`;

/**
 * The fullscreen quad.
 *
 * The geometry is a 2×2 plane centred on the origin, so `position.xy` is
 * already clip space and no camera or projection is involved. Passing the
 * vertices through untransformed removes a whole class of setup — camera
 * frustum, aspect handling, resize bookkeeping — from something that is only
 * ever one rectangle filling one canvas.
 */
export const VERTEX_GLSL = /* glsl */ `#version 300 es
precision highp float;

in vec2 aPosition;
out vec2 vUv;

void main() {
  // The y flip is the upload convention: the texture is uploaded without
  // WebGL's UNPACK_FLIP_Y, so row 0 of the image is v = 0. Flipping here rather
  // than at upload time keeps the artwork and the protection mask — which comes
  // from the analysis buffer in the same top-down order — in the same
  // coordinate system, with nothing to get out of step.
  vUv = vec2(aPosition.x, -aPosition.y) * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const cache = new Map<string, string>();

/**
 * Assembles the fragment shader.
 *
 * Results are memoised by module set. The generated string is identical for the
 * same set in the same order, which is what lets three's program cache do the
 * rest.
 */
export function composeFragment(modules: ShaderModule[]): string {
  if (modules.length > MAX_MODULES) {
    throw new Error(
      `a profile may use at most ${MAX_MODULES} modules, got ${modules.length}`,
    );
  }

  const key = modules.map((m) => m.id).join("+");
  const cached = cache.get(key);
  if (cached) return cached;

  const source = build(modules);
  cache.set(key, source);
  return source;
}

function build(modules: ShaderModule[]): string {
  const stage = (pick: (m: ShaderModule) => string | undefined) =>
    modules
      .map((module, index) => {
        const body = pick(module);
        if (!body) return null;
        // Each module gets its own scope, so two modules declaring the same
        // helper name cannot collide — module authors should not have to know
        // what else is in the shader with them.
        return `  // --- ${module.id} ---\n  {\n    float W = uWeights[${index}] * uIntensity;\n${indent(body)}\n  }`;
      })
      .filter(Boolean)
      .join("\n\n");

  return `#version 300 es
precision highp float;

${UNIFORMS_GLSL}
in vec2 vUv;
out vec4 fragColor;

${OKLAB_GLSL}
${NOISE_GLSL}
${FIDELITY_GLSL}

void main() {
  vec2 uv = vUv;
  float time = uTime;

  /*
   * The protection mask.
   *
   * \`freedom\` is 0 wherever the artwork must not move — text, logos, faces,
   * any hard edge — and every displacing module multiplies by it. That is the
   * whole of the "do not distort typography" guarantee: not a small amplitude,
   * but an amplitude that is exactly zero where it matters.
   */
  float protect = texture(uMask, uv).r;
  float freedom = 1.0 - protect;

  vec2 offset = vec2(0.0);
${stage((m) => m.displace) || "  // no displacing modules in this profile"}

  vec3 srcRgb = texture(uMap, uv).rgb;
  vec3 srcLab = srgbToOklab(srcRgb);

  /*
   * Two-band displacement — the reason parallax here never moves an edge.
   *
   * There is no depth map, and inventing one from luminance is what makes
   * every naive "2.5D photo" effect wobble its text. So the artwork is split
   * by spatial frequency instead: a mip-blurred copy is the soft background
   * band, and what is left over once that is subtracted is the detail band —
   * which contains, by definition, every hard edge, every glyph and every
   * facial feature on the cover.
   *
   * Only the background band is displaced. The detail band is sampled at the
   * original coordinate and added back unmoved. The eye infers depth from the
   * soft field sliding behind the sharp one, exactly as it does from real
   * parallax, but nothing sharp has been touched.
   *
   * Doing it here rather than inside a module means it is not a technique a
   * module chose — it is the only way displacement can be expressed at all.
   */
  vec3 col;
  if (offset == vec2(0.0)) {
    col = srcRgb;
  } else {
    vec3 background = textureLod(uMap, uv, uDepthLod).rgb;
    vec3 moved = textureLod(uMap, uv + offset, uDepthLod).rgb;
    col = clamp(srcRgb - background + moved, 0.0, 1.0);
  }

  vec3 lab = offset == vec2(0.0) ? srcLab : srgbToOklab(col);

${stage((m) => m.tone) || "  // no tone modules in this profile"}

  /*
   * The last word. Whatever the modules did, the result is bounded to within
   * \`uMaxDelta\` of the pixel this fragment started from — including any change
   * caused by the displacement above. See lib/fidelity.ts.
   */
  lab = clampDeviation(srcLab, lab, uMaxDelta);

  fragColor = vec4(resolve(lab, gl_FragCoord.xy), 1.0);
}
`;
}

function indent(body: string): string {
  return body
    .trim()
    .split("\n")
    .map((line) => (line.trim() ? `    ${line}` : line))
    .join("\n");
}

/**
 * Checks that every displacing module gates itself on the mask.
 *
 * The rule is easy to state and easy to forget, and forgetting it is not a
 * subtle bug — it is smeared type on somebody's podcast cover. Rather than rely
 * on review, the module registry is checked at import time: a `displace` body
 * that never mentions `freedom` is a mistake by construction, because there is
 * no legitimate reason for a displacing module to opt out of the mask.
 *
 * Called by `modules/index.ts` over the whole registry, so it fails at module
 * load rather than at first render.
 */
export function assertMasked(modules: ShaderModule[]): void {
  for (const module of modules) {
    if (module.displace && !module.displace.includes("freedom")) {
      throw new Error(
        `shader module ${module.id} displaces without gating on \`freedom\` — ` +
          `every displacing module must multiply by the protection mask`,
      );
    }
  }
}

/** Exposed for tests; the cache is otherwise permanent and correct. */
export function clearShaderCache(): void {
  cache.clear();
}
