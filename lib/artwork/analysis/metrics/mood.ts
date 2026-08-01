/**
 * Derived character: complexity, energy, warmth and a mood label.
 *
 * Nothing here reads the image. Every figure is a combination of the measured
 * metrics, which is deliberate — these are the values profile fitness functions
 * find most natural to reason about ("this profile suits calm, spacious
 * artwork"), and keeping them as a derivation rather than a measurement means
 * there is exactly one place where that judgement lives and it can be retuned
 * without touching anything that touches pixels.
 *
 * The `label` is for the debug overlay and for reading selection decisions back
 * in plain language. No profile is selected by label; they score against the
 * numbers, because a label has already thrown away the margin that separates a
 * cover sitting on a boundary from one sitting well inside it.
 */

import { unit } from "../fields";
import type { EdgeMetrics } from "./edges";
import type { StyleMetrics } from "./style";
import type { SubjectMetrics } from "./subject";
import type { TextureMetrics } from "./texture";
import type { ToneMetrics } from "./tone";

export type MoodLabel =
  | "serene"
  | "intimate"
  | "stark"
  | "bold"
  | "energetic"
  | "warm";

export type MoodMetrics = {
  /** How much is going on, 0–1. Edge density, texture and hue variety together. */
  complexity: number;
  /** How much the cover asserts itself, 0–1. */
  energy: number;
  /** −1 fully cool through 0 neutral to +1 fully warm. */
  warmth: number;
  /** A plain-language summary, for the debug overlay. */
  label: MoodLabel;
};

export function analyseMood(
  tone: ToneMetrics,
  edges: EdgeMetrics,
  texture: TextureMetrics,
  style: StyleMetrics,
  subject: SubjectMetrics,
): MoodMetrics {
  // Negative space is subtracted rather than simply left out: a cover can have
  // dense detail in one corner and nothing elsewhere, and averaging the detail
  // over the whole frame would call that busy when the eye calls it spacious.
  const complexity = unit(
    (edges.density * 0.45 + texture.density * 0.35 + tone.hueEntropy * 0.2) *
      (1 - subject.negativeSpace * 0.5),
  );

  const energy = unit(
    tone.colorfulness * 0.4 + tone.saturation * 0.3 + tone.contrast * 0.3,
  );

  return {
    complexity,
    energy,
    warmth: warmth(tone),
    label: label(tone, complexity, energy, style, subject),
  };
}

/**
 * Projects the dominant hue onto a warm/cool axis.
 *
 * Peak warmth is at 40° (orange) and peak coolness at 220° (blue), which is
 * where the axis actually sits perceptually rather than at the 0°/180° a naive
 * split would use. Scaled by saturation, because an unsaturated cover is
 * neither warm nor cool and reporting a hue for it would be noise.
 */
function warmth(tone: ToneMetrics): number {
  if (tone.saturation <= 0.02) return 0;
  const offset = ((tone.dominantHue - 40 + 540) % 360) - 180;
  return Math.cos((offset * Math.PI) / 180) * Math.min(1, tone.saturation * 2.2);
}

function label(
  tone: ToneMetrics,
  complexity: number,
  energy: number,
  style: StyleMetrics,
  subject: SubjectMetrics,
): MoodLabel {
  // Ordered most specific first. A cover can satisfy several of these; the one
  // that comes first is the one that describes it best, which is why this is a
  // cascade rather than a score.
  if (subject.portraitScore > 0.5) return "intimate";
  if (energy > 0.6 && complexity > 0.55) return "energetic";
  if (energy > 0.55 && style.illustrationScore > 0.5) return "bold";
  if (tone.saturation < 0.18 && tone.contrast > 0.5) return "stark";
  if (tone.brightness > 0.45 && complexity < 0.4) return "serene";
  if (warmth(tone) > 0.35) return "warm";
  return complexity < 0.4 ? "serene" : "bold";
}
