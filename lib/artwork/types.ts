/**
 * The engine's vocabulary.
 *
 * Kept apart from any implementation so that the analysis, the profiles, the
 * shader composer and the React surface can all refer to the same nouns without
 * importing each other. The dependency graph runs one way — analysis knows
 * nothing about profiles, profiles know nothing about the renderer — and this
 * file is what lets it stay that way.
 */

/**
 * A shader module: one self-contained effect that contributes to the frame.
 *
 * Split by what it is *capable of doing*, not by what it looks like, because
 * that is the distinction the hard rules turn on. Eleven of the thirteen touch
 * only luminance or chroma and are therefore geometrically incapable of moving
 * a pixel — no amount of misconfiguration can make `BREATH` distort a glyph.
 * Only `DEPTH_BAND` and `SURFACE` displace, and both are gated by the
 * protection mask.
 */
export type ModuleId =
  // --- luminance ---
  | "SHEEN"
  | "LIGHT_DRIFT"
  | "LIGHT_SWEEP"
  | "BREATH"
  | "GLOW"
  | "SHADOW"
  | "SPECULAR"
  | "VIGNETTE_BREATH"
  // --- chroma ---
  | "CHROMA_FLOW"
  | "CHROMA_EXPAND"
  | "TEMP_SHIFT"
  // --- surface ---
  | "GRAIN"
  // --- displacement (mask-gated) ---
  | "DEPTH_BAND"
  | "SURFACE";

/** The modules that can move a pixel. Everything else is arithmetic on colour. */
export const DISPLACING_MODULES: readonly ModuleId[] = ["DEPTH_BAND", "SURFACE"];

/**
 * Maximum modules in one profile.
 *
 * Fixes the size of the weights uniform array. Four is the most any profile
 * currently uses; eight leaves room without making every shader carry a large
 * array it does not fill.
 */
export const MAX_MODULES = 8;

/**
 * How much of the effect to apply.
 *
 * One scalar multiplied into every module's amplitude *and* into the fidelity
 * clamp's tolerance. That second half is what makes it a single control rather
 * than a suggestion: turning intensity up does not merely make the modules push
 * harder, it widens the bound on how far the result may sit from the original
 * artwork. At zero the bound is zero and the shader is an identity function.
 */
export type Intensity = "off" | "subtle" | "medium" | "expressive";

export const INTENSITY_SCALE: Record<Intensity, number> = {
  off: 0,
  subtle: 0.55,
  medium: 1,
  expressive: 1.6,
};

/**
 * Deviation budget in Oklab L, at `intensity: "medium"`.
 *
 * This is the *clamp*, not the amplitude — see `shaders/modules/amplitude.ts`
 * for what the modules actually aim for and why. It sits deliberately above
 * their peak so that it stays a safety net: a clamp is not a limiter but a
 * clipper, and a module pinned against it turns a smooth light field into flat
 * plateaus with hard edges where it comes off the stop.
 *
 * Set so a single module at full weight (peak 0.05) has room, and only a
 * coincidence of two or three pushing the same way at once engages it. It still
 * bounds the total: whatever happens, no pixel ends more than this far from
 * where it started, and at zero intensity the bound is zero and the shader is
 * an identity function.
 */
export const BASE_MAX_DELTA = 0.3;

/** Identifier for one of the animation profiles in `profiles/`. */
export type ProfileId = string;
