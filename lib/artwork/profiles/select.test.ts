import { describe, expect, it } from "vitest";
import { analysePixels } from "../analysis/analyse";
import type { ArtworkFeatures } from "../analysis/analyse";
import { DISPLACING_MODULES } from "../types";
import { PROFILES, PROFILES_BY_ID } from "./registry";
import { selectProfile } from "./select";

/**
 * "Animation selection should NEVER be random" is the requirement these tests
 * exist for, and it has two halves: the same cover must always produce the same
 * profile, and a cover must never be routed to a profile that would damage it.
 */

const SIZE = 64;

function cover(
  paint: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b] = paint(x, y);
      const i = (y * SIZE + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

const featuresOf = (data: Uint8ClampedArray) => analysePixels(data).features;

const typography = featuresOf(
  cover((x, y) => (y % 32 < 16 && x % 6 < 2 ? [30, 28, 32] : [232, 230, 226])),
);

const portrait = featuresOf(
  cover((x, y) => {
    const dx = x - SIZE / 2;
    const dy = y - SIZE * 0.45;
    return Math.sqrt(dx * dx + dy * dy) < SIZE * 0.22
      ? [198, 152, 128]
      : [40, 52, 78];
  }),
);

const landscape = featuresOf(
  cover((_x, y) => {
    if (y < SIZE * 0.45) return [130, 170, 215];
    if (y < SIZE * 0.52) return [220, 190, 140];
    return [60, 85, 55];
  }),
);

/** Every feature at its midpoint — a cover with no opinion about anything. */
const neutral: ArtworkFeatures = featuresOf(
  cover((x, y) => {
    const v = 120 + Math.round(40 * Math.sin(x / 9) * Math.cos(y / 11));
    return [v, Math.round(v * 0.9), Math.round(v * 0.78)];
  }),
);

const profileFor = (f: ArtworkFeatures, src = "https://example.test/a.jpg") =>
  selectProfile(f, src).profile;

describe("selectProfile", () => {
  it("is deterministic", () => {
    const first = selectProfile(neutral, "https://example.test/a.jpg");
    for (let i = 0; i < 200; i += 1) {
      expect(selectProfile(neutral, "https://example.test/a.jpg").profile.id).toBe(
        first.profile.id,
      );
    }
  });

  it("gives the same show the same profile every time, even on a near tie", () => {
    /*
     * The half of "not random" that determinism alone does not cover. Two
     * profiles scoring within a thousandth of each other would otherwise be
     * separated by floating-point noise, and a show that animates one way today
     * and another way next week is indistinguishable from a random choice.
     */
    const url = "https://cdn.example.test/shows/quiet-hours/cover.jpg";
    const chosen = selectProfile(neutral, url).profile.id;

    for (let i = 0; i < 50; i += 1) {
      expect(selectProfile(neutral, url).profile.id).toBe(chosen);
    }
  });

  it("can give different shows different profiles on the same tie", () => {
    // The tiebreak has to actually distribute, or it is just a constant.
    const ids = new Set(
      Array.from({ length: 60 }, (_, i) =>
        selectProfile(neutral, `https://example.test/show-${i}.jpg`).profile.id,
      ),
    );
    expect(ids.size).toBeGreaterThan(1);
  });

  it("routes text-heavy artwork to Quiet Luminance", () => {
    // The rule is "text-heavy artwork should barely animate", and this is where
    // "barely" is enforced rather than hoped for.
    expect(profileFor(typography).id).toBe("quiet-luminance");
  });

  it("never lets a text-heavy cover reach a displacing profile", () => {
    const selection = selectProfile(typography, "https://example.test/a.jpg");
    expect(displaces(selection.profile.id)).toBe(false);
  });

  it("never lets a portrait reach a displacing profile", () => {
    /*
     * Redundant with the protection mask, which already freezes the detected
     * face region. Deliberately so: the rules about faces are where a single
     * failure costs the most, and this mechanism fails independently of that
     * one.
     */
    expect(portrait.subject.portraitScore).toBeGreaterThan(0.5);

    const selection = selectProfile(portrait, "https://example.test/p.jpg");
    expect(displaces(selection.profile.id)).toBe(false);
    expect(selection.vetoed.some((v) => v.by.includes("portrait"))).toBe(true);
  });

  it("chooses the portrait profile for a portrait", () => {
    expect(profileFor(portrait).id).toBe("cinematic-breathing");
  });

  it("allows depth on a landscape, which is what it is for", () => {
    expect(landscape.subject.landscapeScore).toBeGreaterThan(0.5);
    expect(displaces(profileFor(landscape).id)).toBe(true);
  });

  it("returns Still when motion is disabled", () => {
    const selection = selectProfile(neutral, "x", { motionDisabled: true });
    expect(selection.profile.id).toBe("still");
    expect(selection.profile.modules).toHaveLength(0);
  });

  it("honours an override", () => {
    expect(
      selectProfile(neutral, "x", { override: "glass-reflection-drift" }).profile.id,
    ).toBe("glass-reflection-drift");
  });

  it("ignores an override naming a profile that does not exist", () => {
    // A stale profile id in a saved preference must not break playback.
    const selection = selectProfile(neutral, "x", { override: "does-not-exist" });
    expect(selection.profile.id).not.toBe("does-not-exist");
    expect(selection.profile.modules.length).toBeGreaterThan(0);
  });

  it("never selects Still by scoring", () => {
    for (const src of ["a", "b", "c", "d"]) {
      for (const f of [neutral, portrait, landscape]) {
        expect(selectProfile(f, src).profile.id).not.toBe("still");
      }
    }
  });

  it("explains itself", () => {
    const selection = selectProfile(neutral, "https://example.test/a.jpg");
    expect(selection.reason).toMatch(/fit|tie|text|disabled|ruled out/);
    expect(selection.scores.length).toBeGreaterThan(0);
  });
});

describe("the registry", () => {
  it("has unique ids", () => {
    expect(new Set(PROFILES.map((p) => p.id)).size).toBe(PROFILES.length);
  });

  it("scores every profile inside 0–1 for every kind of cover", () => {
    for (const f of [neutral, portrait, landscape, typography]) {
      for (const profile of PROFILES) {
        const score = profile.fitness(f);
        expect(Number.isFinite(score), `${profile.id} produced ${score}`).toBe(true);
        expect(score, profile.id).toBeGreaterThanOrEqual(0);
        expect(score, profile.id).toBeLessThanOrEqual(1);
      }
    }
  });

  it("vetoes displacement on every profile that displaces, at some text level", () => {
    // A displacing profile with no text veto could be selected for a cover with
    // half its area in type. The mask would still protect the glyphs, but the
    // profile should not have been in the running.
    for (const profile of PROFILES) {
      if (!displaces(profile.id)) continue;
      expect(profile.veto, `${profile.id} displaces but has no veto`).toBeDefined();
      expect(profile.veto!(typography), `${profile.id} allowed a text cover`).toBe(true);
    }
  });

  it("keeps every profile inside the shader's weight array", () => {
    for (const profile of PROFILES) {
      expect(profile.modules.length, profile.id).toBeLessThanOrEqual(8);
    }
  });

  it("gives every profile a positive weight on every module it lists", () => {
    for (const profile of PROFILES) {
      for (const [id, weight] of profile.modules) {
        expect(weight, `${profile.id}/${id}`).toBeGreaterThan(0);
        expect(weight, `${profile.id}/${id}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

function displaces(id: string): boolean {
  const profile = PROFILES_BY_ID.get(id);
  return Boolean(profile?.modules.some(([m]) => DISPLACING_MODULES.includes(m)));
}
