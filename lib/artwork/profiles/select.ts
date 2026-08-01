/**
 * Choosing a profile.
 *
 * "Animation selection should NEVER be random" is the requirement, and it turns
 * out to have a second half that is easy to miss. Making the choice
 * deterministic is the obvious part: same features in, same profile out, no
 * `Math.random` anywhere. But determinism alone is not enough, because two
 * profiles can score within a thousandth of each other, and then the winner is
 * decided by floating-point noise in the analysis — which changes if the image
 * optimizer re-encodes the artwork, or if a metric is retuned by a hair.
 *
 * A show whose artwork animates one way today and another way next week is
 * indistinguishable, to the person using the app, from a random choice. So near
 * ties are broken by a hash of the artwork URL: stable across sessions, across
 * devices and across small changes to the analysis, and still a pure function
 * of its inputs.
 *
 * The whole of this file is pure, which is what lets `select.test.ts` assert
 * the determinism claim by exhaustion rather than by inspection.
 */

import type { ArtworkFeatures } from "../analysis/analyse";
import { DISPLACING_MODULES, type ProfileId } from "../types";
import { PROFILES, PROFILES_BY_ID, QUIET_LUMINANCE, STILL, TEXT_HEAVY } from "./registry";
import type { AnimationProfile } from "./types";

/**
 * Above this portrait score, only profiles that cannot move a pixel are
 * eligible.
 *
 * Redundant with the protection mask, which already paints the detected face
 * region at full strength and would zero any displacement across it. Kept
 * anyway: the rules about faces are the ones where a single failure is most
 * costly, and this is a cheap second mechanism that fails independently of the
 * first. If the mask is somehow wrong about *where* the face is, this is still
 * right that there is one.
 */
const PORTRAIT_THRESHOLD = 0.5;

/**
 * Scores closer than this are a tie.
 *
 * Set well above the noise floor of the analysis rather than at it. The point
 * is not to catch exact ties — those are vanishingly rare with continuous
 * scores — but to catch the much larger set of cases where the margin is too
 * small to mean anything, and hand those to something stable instead.
 */
const TIE_EPSILON = 0.02;

type Scored = { id: ProfileId; score: number; specificity: number };

export type Selection = {
  profile: AnimationProfile;
  /** Why this profile, in a form the debug overlay can print. */
  reason: string;
  /** Every profile's score, highest first. Excludes vetoed profiles. */
  scores: Scored[];
  /** Profiles ruled out, and by what. */
  vetoed: Array<{ id: ProfileId; by: string }>;
};

export type SelectOptions = {
  /** Forces a specific profile, for the debug gallery and the component's `profile` prop. */
  override?: ProfileId;
  /** True when the user or the platform has asked for no motion. */
  motionDisabled?: boolean;
};

export function selectProfile(
  features: ArtworkFeatures,
  src: string,
  options: SelectOptions = {},
): Selection {
  const empty = { scores: [], vetoed: [] };

  if (options.motionDisabled) {
    return { profile: STILL, reason: "motion is disabled", ...empty };
  }

  if (options.override) {
    const forced = PROFILES_BY_ID.get(options.override);
    if (forced) {
      return { profile: forced, reason: `overridden to ${forced.name}`, ...empty };
    }
  }

  /*
   * The forced route.
   *
   * Checked before scoring rather than expressed as a fitness function, because
   * it is not a preference that could be outvoted. A cover that is mostly type
   * gets one breath and nothing else, whatever else it might also be.
   */
  if (features.text.amount > TEXT_HEAVY) {
    return {
      profile: QUIET_LUMINANCE,
      reason: `text covers ${percent(features.text.amount)} of the artwork`,
      ...empty,
    };
  }

  const isPortrait = features.subject.portraitScore > PORTRAIT_THRESHOLD;

  const vetoed: Selection["vetoed"] = [];
  const candidates: AnimationProfile[] = [];

  for (const profile of PROFILES) {
    if (profile === STILL) continue;

    if (profile.veto?.(features)) {
      vetoed.push({ id: profile.id, by: "profile veto" });
      continue;
    }

    if (isPortrait && displaces(profile)) {
      vetoed.push({ id: profile.id, by: "portrait: displacement not permitted" });
      continue;
    }

    candidates.push(profile);
  }

  // Every profile ruled out is possible in principle and must not be a crash.
  // One breath is always safe.
  if (candidates.length === 0) {
    return {
      profile: QUIET_LUMINANCE,
      reason: "every profile was ruled out",
      scores: [],
      vetoed,
    };
  }

  const scores = candidates
    .map((profile) => ({
      id: profile.id,
      score: profile.fitness(features),
      specificity: profile.specificity ?? 0,
    }))
    .sort(
      (a, b) =>
        b.score - a.score || b.specificity - a.specificity || compare(a.id, b.id),
    );

  /*
   * Ties are resolved in two steps, and the order matters.
   *
   * Specificity first: when a portrait profile and a generic soft-edge profile
   * both score 1.0, that is not a coin flip — one of them recognised something
   * about the cover and the other only failed to object to it. Deciding those
   * by hash would be deterministic and still wrong, in the sense that the
   * animation would have nothing to do with the artwork.
   *
   * The hash then handles what is left: profiles equally confident and equally
   * suited, where there genuinely is no better answer and the only requirement
   * is that the same show gets the same one forever.
   */
  const best = scores[0].score;
  const near = scores.filter((s) => best - s.score <= TIE_EPSILON);
  const topSpecificity = Math.max(...near.map((s) => s.specificity));
  const tied = near.filter((s) => s.specificity === topSpecificity);

  const winner = tied.length === 1 ? tied[0] : tied[hash(src) % tied.length];

  return {
    profile: PROFILES_BY_ID.get(winner.id)!,
    reason: describe(winner, near, tied, best),
    scores,
    vetoed,
  };
}

function describe(winner: Scored, near: Scored[], tied: Scored[], best: number): string {
  if (near.length === 1) return `best fit at ${winner.score.toFixed(2)}`;
  if (tied.length === 1) {
    return `${near.length} profiles fit at ~${best.toFixed(2)}; won on specificity`;
  }
  return `${tied.length}-way tie at ~${best.toFixed(2)}, broken by artwork hash`;
}

function displaces(profile: AnimationProfile): boolean {
  return profile.modules.some(([id]) => DISPLACING_MODULES.includes(id));
}

/**
 * FNV-1a, 32-bit.
 *
 * Any stable hash would do; this one is four lines and has no dependencies. The
 * requirement is only that it be a pure function of the string and identical on
 * every device — not that it resist anything.
 */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Keeps the sort total, so equal scores do not depend on the registry's order. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
