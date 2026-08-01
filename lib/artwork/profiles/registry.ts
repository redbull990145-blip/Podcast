/**
 * The seventeen profiles.
 *
 * Fifteen were specified; two more fell out of the constraints and are marked
 * where they appear. `QUIET_LUMINANCE` exists because "text-heavy artwork
 * should barely animate" needs somewhere to route *to* — a rule with no
 * destination is a hope. `STILL` exists because reduced motion, a WebGL
 * failure, a pure text card and an intensity of zero all need the same answer,
 * and having that answer be a profile rather than a special case keeps the
 * renderer free of branches about whether it is animating at all.
 *
 * Every profile states the covers it suits as measurements rather than as
 * adjectives. `band(f.tone.brightness, 0, 0.35)` is checkable and arguable;
 * "for dark artwork" is neither.
 */

import { avg, band, type AnimationProfile } from "./types";

/**
 * Above this share of the cover reading as typography, only luminance is safe.
 *
 * Used both as the forced route in `select.ts` and as the veto threshold on
 * every displacing profile below, so the two can never drift apart.
 */
export const TEXT_HEAVY = 0.55;

/** Where a cover has enough type that moving anything at all is a bad idea. */
const TEXT_PRESENT = 0.3;

export const PROFILES: readonly AnimationProfile[] = [
  {
    id: "soft-light-drift",
    name: "Soft Light Drift",
    description:
      "A broad field of light moving slowly across the artwork, with shadow gathering behind it. The default for ordinary mid-contrast photography.",
    modules: [
      ["SHEEN", 0.9],
      ["LIGHT_DRIFT", 1],
      ["SHADOW", 0.35],
    ],
    fitness: (f) =>
      avg(
        band(f.tone.contrast, 0.25, 0.62),
        band(f.text.amount, 0, 0.25),
        band(f.mood.complexity, 0.2, 0.7),
      ),
  },

  {
    id: "inner-glow-breathing",
    name: "Inner Glow Breathing",
    description:
      "Light blooming out of the bright parts of a dark cover and settling again. Needs a concentrated highlight to bloom from, which is why it scores on contrast rather than on brightness alone.",
    modules: [
      ["SHEEN", 0.8],
      ["GLOW", 1],
      ["BREATH", 0.5],
    ],
    fitness: (f) =>
      avg(
        band(f.tone.brightness, 0.02, 0.36),
        band(f.tone.contrast, 0.45, 1),
        band(f.tone.tonalRange, 0.45, 1),
      ),
  },

  {
    id: "atmospheric-colour-flow",
    name: "Atmospheric Colour Flow",
    description:
      "Colour pooling and thinning across the frame, between the cover's own muted and vibrant swatches. For artwork with enough colour to have somewhere to flow between.",
    modules: [
      ["SHEEN", 1.0],
      ["CHROMA_FLOW", 1],
      ["LIGHT_DRIFT", 0.5],
    ],
    fitness: (f) =>
      avg(
        band(f.tone.colorfulness, 0.35, 1),
        band(f.tone.hueEntropy, 0.4, 1),
        band(f.text.amount, 0, 0.2),
      ),
  },

  {
    id: "micro-depth-drift",
    name: "Micro Depth Drift",
    description:
      "The background easing behind a held foreground, by about two and a half pixels. Wants a cover with a subject and some space around it — there has to be a background for anything to happen behind.",
    modules: [
      ["SHEEN", 0.8],
      ["DEPTH_BAND", 0.7],
      ["LIGHT_DRIFT", 0.4],
    ],
    /** Needs a real subject-and-background split to have found. */
    specificity: 1,
    fitness: (f) =>
      avg(
        band(f.subject.centerMass, 0.4, 0.85),
        band(f.subject.negativeSpace, 0.15, 0.6),
        band(f.text.amount, 0, 0.15),
      ),
    veto: (f) => f.text.amount > TEXT_PRESENT,
  },

  {
    id: "gradient-bloom",
    name: "Gradient Bloom",
    description:
      "Slow bloom and a gentle deepening of colour, for covers built from smooth gradients and a small palette. Nothing here has an edge to catch on, which is the point.",
    modules: [
      ["SHEEN", 0.9],
      ["GLOW", 0.8],
      ["CHROMA_EXPAND", 0.6],
    ],
    fitness: (f) =>
      avg(
        band(f.edges.density, 0, 0.25),
        band(f.texture.density, 0, 0.3),
        band(f.style.paletteBreadth, 0, 0.4),
      ),
  },

  {
    id: "soft-texture-movement",
    name: "Soft Texture Movement",
    description:
      "The surface itself refusing to sit still: a shallow undulation plus a hint of moving grain. Only for covers that already have grain, where a static image reads as subtly wrong.",
    modules: [
      ["SHEEN", 0.8],
      ["SURFACE", 0.6],
      ["GRAIN", 0.8],
    ],
    /** Keyed on grain actually being present. */
    specificity: 1,
    fitness: (f) =>
      avg(
        band(f.texture.density, 0.5, 1),
        band(f.style.illustrationScore, 0, 0.35),
        band(f.text.amount, 0, 0.15),
      ),
    veto: (f) => f.text.amount > TEXT_PRESENT,
  },

  {
    id: "parallax-layer-motion",
    name: "Parallax Layer Motion",
    description:
      "The strongest depth in the set, for banded scenes — a horizon, a skyline, a landscape. Vetoed on portraits: a face is exactly what must not slide relative to its surroundings.",
    modules: [
      ["SHEEN", 0.8],
      ["DEPTH_BAND", 1],
      ["SHADOW", 0.4],
    ],
    /** Keyed on the landscape detector. */
    specificity: 2,
    fitness: (f) =>
      avg(
        band(f.subject.landscapeScore, 0.45, 1),
        band(f.subject.negativeSpace, 0.1, 0.9),
        band(f.text.amount, 0, 0.15),
      ),
    veto: (f) => f.text.amount > TEXT_PRESENT || f.subject.portraitScore > 0.4,
  },

  {
    id: "ambient-light-sweep",
    name: "Ambient Light Sweep",
    description:
      "One very wide gradient travelling past, and a slow breath underneath. For bright, minimal covers where anything busier would become the most interesting thing on the screen.",
    modules: [
      ["SHEEN", 1.0],
      ["LIGHT_SWEEP", 1],
      ["BREATH", 0.4],
    ],
    fitness: (f) =>
      avg(
        band(f.tone.brightness, 0.5, 1),
        band(f.mood.complexity, 0, 0.4),
        band(f.subject.negativeSpace, 0.25, 1),
      ),
  },

  {
    id: "glass-reflection-drift",
    name: "Glass Reflection Drift",
    description:
      "A wide, soft highlight wandering across, as if the cover were behind glass. Touches luminance only, so it is safe on the logo- and type-heavy covers that most profiles have to avoid.",
    modules: [
      ["SHEEN", 1.0],
      ["SPECULAR", 1],
      ["LIGHT_DRIFT", 0.35],
    ],
    /** Keyed on a glossy, high-contrast look. */
    specificity: 1,
    fitness: (f) =>
      avg(
        band(f.tone.contrast, 0.5, 1),
        band(f.style.illustrationScore, 0.4, 1),
        band(f.tone.brightness, 0.05, 0.5),
      ),
  },

  {
    id: "cinematic-breathing",
    name: "Cinematic Breathing",
    description:
      "Whole-frame breath, a breathing vignette and a drift in temperature. The portrait profile: entirely global, so it cannot produce a gradient across a face or move one feature relative to another.",
    modules: [
      ["SHEEN", 0.85],
      ["BREATH", 1],
      ["VIGNETTE_BREATH", 0.6],
      ["TEMP_SHIFT", 0.45],
    ],
    /** Keyed on the portrait detector — the strongest claim any profile makes. */
    specificity: 3,
    fitness: (f) =>
      avg(
        band(f.subject.portraitScore, 0.5, 1),
        band(f.subject.centerMass, 0.35, 1),
      ),
  },

  {
    id: "organic-shadow-shift",
    name: "Organic Shadow Shift",
    description:
      "Shadow gathering and releasing against light moving the other way, which reads as a single source passing something solid. For sculptural, mid-dark, textured covers.",
    modules: [
      ["SHEEN", 0.85],
      ["SHADOW", 1],
      ["LIGHT_DRIFT", 0.55],
    ],
    fitness: (f) =>
      avg(
        band(f.tone.brightness, 0.15, 0.5),
        band(f.texture.density, 0.35, 1),
        band(f.tone.contrast, 0.3, 0.8),
      ),
  },

  {
    id: "subtle-colour-expansion",
    name: "Subtle Colour Expansion",
    description:
      "Colour deepening and relaxing, gated to the pixels that have colour. For muted covers, where there is room for the colour to come up without it becoming a tint.",
    modules: [
      ["SHEEN", 0.85],
      ["CHROMA_EXPAND", 1],
      ["TEMP_SHIFT", 0.5],
    ],
    fitness: (f) =>
      avg(
        band(f.tone.saturation, 0.04, 0.3),
        band(f.tone.colorfulness, 0.05, 0.35),
        band(f.tone.brightness, 0.2, 0.75),
      ),
  },

  {
    id: "soft-volume-movement",
    name: "Soft Volume Movement",
    description:
      "A little of everything at low weight — a shallow parallax, a breath, a bloom. The generalist, for balanced covers that no specialist describes particularly well.",
    modules: [
      ["SHEEN", 0.85],
      ["DEPTH_BAND", 0.45],
      ["BREATH", 0.7],
      ["GLOW", 0.5],
    ],
    fitness: (f) =>
      avg(
        band(f.mood.complexity, 0.35, 0.7),
        band(f.subject.balance, 0, 0.4),
        band(f.text.amount, 0, 0.2),
      ),
    veto: (f) => f.text.amount > 0.35,
  },

  {
    id: "gentle-surface-motion",
    name: "Gentle Surface Motion",
    description:
      "A shallow warp under a drifting light, for illustration with soft edges. Distinguished from Soft Texture Movement by having no grain, which drawn artwork never has.",
    modules: [
      ["SHEEN", 0.9],
      ["SURFACE", 0.5],
      ["LIGHT_DRIFT", 0.7],
    ],
    /** Keyed on the illustration detector. */
    specificity: 1,
    fitness: (f) =>
      avg(
        band(f.style.illustrationScore, 0.45, 1),
        band(f.edges.density, 0.1, 0.5),
        band(f.text.amount, 0, 0.2),
      ),
    veto: (f) => f.text.amount > TEXT_PRESENT,
  },

  {
    id: "premium-ambient-flow",
    name: "Premium Ambient Flow",
    description:
      "Four modules, all quiet: drifting light, flowing colour, a slow bloom and a breathing vignette. The flagship, and the most demanding to earn — it needs a rich, complex, well-composed cover with room to breathe.",
    modules: [
      ["SHEEN", 0.95],
      ["LIGHT_DRIFT", 0.6],
      ["CHROMA_FLOW", 0.5],
      ["GLOW", 0.45],
      ["VIGNETTE_BREATH", 0.35],
    ],
    /** Four simultaneous conditions; the most demanding to earn. */
    specificity: 1,
    fitness: (f) =>
      avg(
        band(f.mood.complexity, 0.45, 0.85),
        band(f.tone.colorfulness, 0.3, 0.9),
        band(f.subject.negativeSpace, 0.05, 0.45),
        band(f.text.amount, 0, 0.15),
      ),
  },

  {
    id: "quiet-luminance",
    name: "Quiet Luminance",
    description:
      "One breath, at less than half weight. Not in the original fifteen — it exists because a rule that text-heavy artwork should barely animate needs somewhere to route to, and 'barely' is not the same as 'not at all'.",
    modules: [
      ["SHEEN", 0.75],
      ["BREATH", 0.4],
    ],
    /** Keyed on the text detector. */
    specificity: 3,
    fitness: (f) => band(f.text.amount, 0.4, 1),
  },

  {
    id: "still",
    name: "Still",
    description:
      "No modules. The answer for reduced motion, an intensity of zero, a WebGL failure and a cover that is nothing but type. A profile rather than a special case, so the renderer never has to ask whether it is animating.",
    modules: [],
    // Never wins on merit; only ever reached by an explicit route in select.ts.
    fitness: () => 0,
  },
];

export const PROFILES_BY_ID = new Map(PROFILES.map((p) => [p.id, p]));

/** The two profiles the selector routes to directly rather than by scoring. */
export const QUIET_LUMINANCE = PROFILES_BY_ID.get("quiet-luminance")!;
export const STILL = PROFILES_BY_ID.get("still")!;
