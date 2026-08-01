import { describe, expect, it } from "vitest";
import { analysePixels } from "./analyse";
import { buildFields, maskedMean, maskedPercentile } from "./fields";

/**
 * Synthetic covers.
 *
 * Every metric in this directory claims to separate one kind of artwork from
 * another, and the only way to hold it to that is to build the kinds and check
 * the separation. These fixtures are deliberately extreme — a real cover is a
 * mixture — because a metric that cannot tell pure noise from pure type has no
 * chance on anything in between.
 */

const SIZE = 64;

type Paint = (x: number, y: number) => [number, number, number] | [number, number, number, number];

function cover(paint: Paint, size = SIZE): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a = 255] = paint(x, y);
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

/**
 * Deterministic pseudo-random, so a failure is always reproducible. A seeded
 * generator matters more than usual here: several assertions are about a noisy
 * fixture *not* tripping a detector, and a flaky one would be worse than none.
 */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const solid = (r: number, g: number, b: number) => cover(() => [r, g, b]);

const gradient = cover((_x, y) => {
  const v = Math.round((y / (SIZE - 1)) * 255);
  return [v, v, v];
});

/**
 * Sensor noise around a mid grey: what every photograph has and no vector art
 * does.
 *
 * The noise is drawn per channel rather than applied to one value and scaled.
 * That distinction is not cosmetic — correlated channels collapse the cover
 * onto a one-dimensional line through colour space, which occupies a few dozen
 * quantised bins instead of a few thousand and makes `paletteBreadth` read like
 * a designed palette. Real sensor noise is independent per channel.
 */
const photograph = (() => {
  const rand = noise(7);
  return cover((x, y) => {
    const base = 110 + 60 * Math.sin((x + y) / 14);
    const channel = (scale: number) =>
      Math.max(0, Math.min(255, Math.round(base * scale + (rand() - 0.5) * 70)));
    return [channel(1), channel(0.92), channel(0.8)];
  });
})();

/** Flat plateaus with hard boundaries: vector art. */
const illustration = cover((x, y) => {
  if (x < 20) return [230, 60, 50];
  if (x < 42) return [40, 90, 180];
  return y < 32 ? [250, 210, 60] : [30, 30, 40];
});

/**
 * Lines of type: dark strokes on a light ground, banded vertically with
 * leading between them. Stroke period is 6px so it does not align with the
 * 8px analysis block — aligned strokes would land one crossing per row instead
 * of two and understate the very signal being tested.
 */
const typography = cover((x, y) => {
  const inLine = y % 32 < 16;
  const onStroke = x % 6 < 2;
  return inLine && onStroke ? [30, 28, 32] : [232, 230, 226];
});

/** A warm subject mass in the middle of a cool ground. */
const portrait = cover((x, y) => {
  const dx = x - SIZE / 2;
  const dy = y - SIZE * 0.45;
  const inside = Math.sqrt(dx * dx + dy * dy) < SIZE * 0.22;
  // Inside the mass the values sit in the YCbCr skin gamut; outside they do not.
  return inside ? [198, 152, 128] : [40, 52, 78];
});

/** Sky over horizon over ground: rows nearly uniform, very different from each other. */
const landscape = cover((_x, y) => {
  if (y < SIZE * 0.45) return [130, 170, 215];
  if (y < SIZE * 0.52) return [220, 190, 140];
  return [60, 85, 55];
});

const features = (data: Uint8ClampedArray) => analysePixels(data).features;

// ---------------------------------------------------------------------------

describe("buildFields", () => {
  it("excludes transparent pixels rather than reading them as black", () => {
    // A cut-out PNG: half the frame is a bright colour, half is nothing. Read
    // naively the empty half is black and the cover looks dark and contrasty.
    const fields = buildFields(
      cover((x) => (x < SIZE / 2 ? [200, 200, 200] : [0, 0, 0, 0])),
    );

    expect(fields.opaqueCount).toBe((SIZE * SIZE) / 2);
    expect(maskedMean(fields.luma, fields)).toBeCloseTo(200 / 255, 2);
  });

  it("reports zero rather than NaN for a fully transparent cover", () => {
    const fields = buildFields(cover(() => [10, 20, 30, 0]));
    expect(fields.opaqueCount).toBe(0);
    expect(maskedMean(fields.luma, fields)).toBe(0);
    expect(maskedPercentile(fields.luma, fields, 0.5)).toBe(0);
  });

  it("leaves hue and saturation at zero for greys", () => {
    const fields = buildFields(solid(120, 120, 120));
    expect(maskedMean(fields.sat, fields)).toBe(0);
    expect(maskedMean(fields.hue, fields)).toBe(0);
  });
});

describe("tone", () => {
  it("reads brightness off a flat cover", () => {
    expect(features(solid(0, 0, 0)).tone.brightness).toBeCloseTo(0, 2);
    expect(features(solid(255, 255, 255)).tone.brightness).toBeCloseTo(1, 2);
  });

  it("gives a flat cover no contrast and a full-range one plenty", () => {
    expect(features(solid(128, 128, 128)).tone.contrast).toBe(0);
    expect(features(gradient).tone.contrast).toBeGreaterThan(0.5);
  });

  it("separates saturation from colourfulness", () => {
    // One vivid colour everywhere: fully saturated, but there is only one hue,
    // so there is nothing colourful about it in the sense that matters.
    const single = features(solid(220, 30, 30)).tone;
    expect(single.saturation).toBeGreaterThan(0.7);
    expect(single.colorfulness).toBeLessThan(single.saturation);

    // Four strong hues: less mean saturation is possible, far more spread.
    expect(features(illustration).tone.colorfulness).toBeGreaterThan(
      single.colorfulness,
    );
  });

  it("finds the dominant hue and reports no hue for greys", () => {
    expect(features(solid(220, 30, 30)).tone.dominantHue).toBeLessThan(30);
    expect(features(solid(30, 30, 220)).tone.dominantHue).toBeGreaterThan(200);

    const grey = features(solid(120, 120, 120)).tone;
    expect(grey.hueConcentration).toBe(0);
    expect(grey.hueEntropy).toBe(0);
  });

  it("catches crushed shadows", () => {
    expect(features(solid(2, 2, 2)).tone.shadowClipping).toBe(1);
    expect(features(solid(128, 128, 128)).tone.shadowClipping).toBe(0);
  });
});

describe("edges", () => {
  it("finds nothing in a flat cover and a great deal in type", () => {
    expect(features(solid(90, 90, 90)).edges.density).toBe(0);
    expect(features(typography).edges.density).toBeGreaterThan(0.5);
  });

  it("reports horizontal banding for a landscape and none for a flat cover", () => {
    expect(features(landscape).edges.horizontalBanding).toBeGreaterThan(0.9);
    expect(features(solid(90, 90, 90)).edges.horizontalBanding).toBe(0);
  });

  it("reports vertical structure as negative banding", () => {
    // Vertical stripes: the gradient points sideways, so the sign flips.
    const stripes = cover((x) => (x % 8 < 4 ? [220, 220, 220] : [40, 40, 40]));
    expect(features(stripes).edges.horizontalBanding).toBeLessThan(-0.9);
  });
});

describe("texture", () => {
  it("calls a flat cover entirely negative space", () => {
    expect(features(solid(70, 70, 70)).texture.flatArea).toBe(1);
    expect(features(solid(70, 70, 70)).texture.density).toBe(0);
  });

  it("finds density in grain", () => {
    expect(features(photograph).texture.density).toBeGreaterThan(0.4);
  });

  it("measures negative space as the share of the cover with nothing in it", () => {
    // Detail in the top third, empty below. `flatArea` should report the empty
    // part and nothing else — this is the figure a profile reads to decide how
    // wide a light field may drift without crossing anything.
    const rand = noise(3);
    const partly = cover((_x, y) => {
      if (y >= SIZE / 3) return [70, 70, 70];
      const v = Math.round(rand() * 255);
      return [v, v, v];
    });

    expect(features(partly).texture.flatArea).toBeGreaterThan(0.6);
    expect(features(partly).texture.flatArea).toBeLessThan(0.75);
  });
});

describe("text", () => {
  it("finds type", () => {
    expect(features(typography).text.amount).toBeGreaterThan(0.3);
  });

  it("finds large display type, not just body-sized type", () => {
    /*
     * The regression this pins was found on a real cover, not in a fixture: a
     * title filling a third of the frame scored 1%, because at a single 8px
     * block size a window frequently spans one stroke of a large glyph and
     * counts one crossing — indistinguishable from a plain edge.
     *
     * Podcast covers put their titles in display type almost by definition, so
     * missing it meant missing the case the metric exists for. Strokes here are
     * 5px on a 14px period, which is what a headline looks like at the analysis
     * resolution.
     */
    const headline = cover((x, y) => {
      const inLine = y % 40 < 24;
      const onStroke = x % 14 < 5;
      return inLine && onStroke ? [24, 22, 26] : [236, 234, 230];
    });

    expect(features(headline).text.amount).toBeGreaterThan(0.3);
  });

  it("does not mistake photographic grain for type", () => {
    // The case that broke the first version of this detector: noise is more
    // bimodal and busier than type, and only the vertical-coherence term tells
    // them apart. If this regresses, every grainy cover animates like a text
    // card.
    expect(features(photograph).text.amount).toBeLessThan(0.05);
  });

  it("does not mistake a hard boundary for type", () => {
    // One crossing per row, perfectly bimodal, perfectly coherent — everything
    // type has except the repetition. A logo edge must not read as a headline.
    const boundary = cover((x) => (x < SIZE / 2 ? [20, 20, 20] : [235, 235, 235]));
    expect(features(boundary).text.amount).toBeLessThan(0.05);
  });

  it("does not mistake a smooth gradient for type", () => {
    expect(features(gradient).text.amount).toBeLessThan(0.05);
  });

  it("scores type far above every non-text fixture", () => {
    const typeScore = features(typography).text.amount;
    for (const other of [photograph, gradient, illustration, portrait, landscape]) {
      expect(features(other).text.amount).toBeLessThan(typeScore / 3);
    }
  });
});

describe("style", () => {
  it("separates vector art from photography by its plateaus", () => {
    const drawn = features(illustration).style;
    const shot = features(photograph).style;

    expect(drawn.plateauArea).toBeGreaterThan(0.5);
    expect(shot.plateauArea).toBeLessThan(0.05);
    expect(drawn.illustrationScore).toBeGreaterThan(0.7);
    expect(shot.illustrationScore).toBeLessThan(0.3);
  });

  it("counts a designed palette as narrow and a photographed one as broad", () => {
    expect(features(illustration).style.paletteBreadth).toBeLessThan(0.1);
    expect(features(photograph).style.paletteBreadth).toBeGreaterThan(0.5);
  });
});

describe("subject", () => {
  it("centres the subject of a centred cover", () => {
    const { centroid, zone } = features(portrait).subject;
    expect(centroid.x).toBeCloseTo(0.5, 1);
    expect(zone).toBe("center");
  });

  it("finds a compact skin mass and marks it for protection", () => {
    const { portraitScore, protectedRegion } = features(portrait).subject;
    expect(portraitScore).toBeGreaterThan(0.5);
    expect(protectedRegion).not.toBeNull();
    expect(protectedRegion!.x).toBeCloseTo(0.5, 1);
    // Generous enough to cover hair and shoulders, not so generous it freezes
    // the whole cover.
    expect(protectedRegion!.radius).toBeGreaterThan(0.1);
    expect(protectedRegion!.radius).toBeLessThan(0.6);
  });

  it("does not call a warm background a portrait", () => {
    // Terracotta fills the skin gamut but covers the frame. Compactness, not
    // colour, is what makes the difference.
    const terracotta = features(solid(198, 152, 128)).subject;
    expect(terracotta.portraitScore).toBeLessThan(0.2);
    expect(terracotta.protectedRegion).toBeNull();
  });

  it("recognises a banded scene as a landscape and a subject as not", () => {
    expect(features(landscape).subject.landscapeScore).toBeGreaterThan(0.5);
    expect(features(portrait).subject.landscapeScore).toBeLessThan(0.3);
  });

  it("reports even quadrants as balanced and a corner subject as not", () => {
    const corner = cover((x, y) =>
      x < SIZE / 3 && y < SIZE / 3 ? [240, 240, 240] : [20, 20, 20],
    );
    expect(features(corner).subject.balance).toBeGreaterThan(0.3);
    // Grain covers the frame evenly, so no quadrant holds more detail than any
    // other. The landscape fixture is deliberately not used here: its two
    // horizon edges differ fourfold in strength, so its detail genuinely is
    // lopsided and calling that "balanced" would be testing the wrong thing.
    expect(features(photograph).subject.balance).toBeLessThan(0.1);
  });
});

describe("mood", () => {
  it("calls a centred person intimate", () => {
    expect(features(portrait).mood.label).toBe("intimate");
  });

  it("reads warmth off the dominant hue and neutrality off a grey", () => {
    expect(features(solid(230, 140, 40)).mood.warmth).toBeGreaterThan(0.5);
    expect(features(solid(40, 120, 230)).mood.warmth).toBeLessThan(-0.5);
    expect(features(solid(120, 120, 120)).mood.warmth).toBe(0);
  });

  it("discounts complexity where there is negative space", () => {
    // Same busy strip in both, but the second has room around it.
    const full = features(photograph).mood.complexity;
    const sparse = features(
      cover((x, y) => (y < SIZE / 4 ? [255 * ((x * 37) % 2), 120, 90] : [60, 60, 60])),
    ).mood.complexity;
    expect(sparse).toBeLessThan(full);
  });
});

describe("analysePixels", () => {
  it("is deterministic", () => {
    const a = JSON.stringify(features(photograph));
    const b = JSON.stringify(features(photograph));
    expect(a).toBe(b);
  });

  it("reports every figure inside its declared range", () => {
    for (const fixture of [
      solid(0, 0, 0),
      solid(255, 255, 255),
      gradient,
      photograph,
      illustration,
      typography,
      portrait,
      landscape,
      cover(() => [0, 0, 0, 0]),
    ]) {
      walk(features(fixture), (path, value) => {
        expect(Number.isFinite(value), `${path} is not finite`).toBe(true);
        // warmth is the one signed figure; everything else is 0–1.
        const min = path.endsWith("warmth") || path.endsWith("horizontalBanding") ? -1 : 0;
        const max = path.endsWith("dominantHue") ? 360 : 1;
        expect(value, `${path} = ${value}`).toBeGreaterThanOrEqual(min);
        expect(value, `${path} = ${value}`).toBeLessThanOrEqual(max);
      });
    }
  });
});

/** Visits every number in a nested plain object, reporting its dotted path. */
function walk(node: unknown, visit: (path: string, value: number) => void, path = ""): void {
  if (typeof node === "number") return visit(path, node);
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    walk(value, visit, path ? `${path}.${key}` : key);
  }
}
