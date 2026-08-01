/**
 * What an animation profile is.
 *
 * A profile is **data**, not code: a list of modules with weights, plus a
 * function scoring how well it suits a given cover. There is no per-profile
 * shader, no per-profile component and no per-profile branch anywhere in the
 * renderer. Adding one means adding an entry to `registry.ts`.
 *
 * That constraint is what makes "support future animation profiles" true rather
 * than aspirational, and it has a second benefit worth as much: because a
 * profile is a plain object, the entire selection system is pure and can be
 * unit-tested exhaustively — which matters a great deal for a requirement that
 * reads "animation selection should NEVER be random".
 */

import type { ArtworkFeatures } from "../analysis/analyse";
import type { ModuleId, ProfileId } from "../types";

export type AnimationProfile = {
  id: ProfileId;
  /** Shown in the debug overlay. */
  name: string;
  /** Why this profile exists and what it is for. */
  description: string;
  /**
   * Modules and their weights, in order.
   *
   * Position matters: it is the index into the shader's `uWeights` array, so
   * reordering a profile's modules changes which weight each one receives.
   */
  modules: ReadonlyArray<readonly [ModuleId, number]>;
  /**
   * How well this profile suits a cover, 0–1.
   *
   * Scored against the measured features rather than against the derived mood
   * label, deliberately: a label has already discarded the margin that
   * separates a cover sitting on a boundary from one sitting well inside it,
   * and that margin is exactly what decides a close call between two profiles.
   */
  fitness: (features: ArtworkFeatures) => number;
  /**
   * How specific a claim this profile is making, 0 upward. Defaults to 0.
   *
   * Fitness scores saturate: several profiles can legitimately score 1.0 on the
   * same cover, because scoring "inside the range I asked for" has no way to
   * express *how much* was asked for. A profile keyed on a confident, rare
   * detection — this is a portrait; this is a banded landscape — is making a
   * far stronger claim than one keyed on a cover merely having soft edges, and
   * when both fit, the strong claim should win.
   *
   * Used only to order profiles that have already tied on score, ahead of the
   * hash tiebreak. That ordering makes the common case decided by meaning
   * rather than by a hash, and leaves the hash for genuine coin flips between
   * equally specific profiles.
   */
  specificity?: number;
  /**
   * Covers this profile must never be used for.
   *
   * Separate from a low fitness score, because these are different statements.
   * A low score says "something else suits this better"; a veto says "this
   * would be wrong", and it holds even when every alternative scores worse.
   * Every veto in the registry is about protecting the artwork rather than
   * about taste.
   */
  veto?: (features: ArtworkFeatures) => boolean;
};

/**
 * A soft preference for a value falling inside a range.
 *
 * Returns 1 anywhere in `[low, high]` and falls off linearly outside it. The
 * falloff is proportional to the band's own width, with a floor — so a profile
 * asking for a narrow range is not punished by having its shoulders be
 * proportionally narrow too, which would make narrow-band profiles
 * unselectable in practice.
 */
export function band(value: number, low: number, high: number): number {
  if (value >= low && value <= high) return 1;

  const margin = Math.max(0.18, (high - low) * 0.5);
  const distance = value < low ? low - value : value - high;
  return Math.max(0, 1 - distance / margin);
}

/**
 * The mean of several criteria.
 *
 * Arithmetic rather than geometric. A geometric mean would let any single
 * unmet criterion zero the whole profile, which sounds rigorous and behaves
 * badly: real covers rarely satisfy every clause of any description, and a
 * profile that has to be a perfect fit is a profile that never wins. Hard
 * requirements belong in `veto`, where they are stated as such.
 */
export function avg(...scores: number[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}
