/**
 * The protection mask.
 *
 * This is the single most important thing in the engine. Every rule about not
 * distorting text, logos, typography or faces reduces to one line of GLSL:
 *
 *     vec2 displaced = uv + offset * (1.0 - protect) * amplitude;
 *
 * Where `protect` is 1, no displacing module can move a pixel however hard it
 * tries, because its amplitude has been multiplied by zero. The rule is not a
 * setting anyone can turn up, and it does not depend on a profile being chosen
 * correctly or a constant being tuned conservatively — it is arithmetic.
 *
 * What makes it work is that **text is the highest-gradient content a podcast
 * cover contains.** A glyph is a maximally sharp light/dark boundary repeated
 * every few pixels. So a plain Sobel identifies typography without needing to
 * know what typography is, which is why the text classifier in `metrics/text.ts`
 * being a heuristic costs nothing: it decides how *calm* an animation should be,
 * while this decides what may move at all, and this one does not consult it for
 * permission — only for reinforcement.
 *
 * Three inputs are combined, and each is on its own sufficient:
 *
 *   1. Gradient magnitude, which catches every edge including ones nothing
 *      classified.
 *   2. The text field, which extends protection across the interior of a word
 *      where the gaps between strokes have no gradient of their own.
 *   3. The detected face region, painted at full strength.
 */

import { unit } from "./fields";

/**
 * Mask resolution.
 *
 * 64² is 4 KB as a single-channel texture, and the mask never needs to be
 * sharper than the thing it gates: displacement is 1–3px, so a boundary
 * resolved to within 10 display pixels is already an order of magnitude finer
 * than the motion it is stopping. A sharper mask would cost memory to encode a
 * precision the effect cannot express.
 */
export const MASK_SIZE = 64;

/**
 * Where a gradient starts and stops mattering.
 *
 * Below 0.1 is the noise floor of a photograph — protecting it would freeze the
 * entire cover. By 0.4 the boundary is as hard as rendered type, and protection
 * is total. `smoothstep` between them rather than a step, because a hard mask
 * boundary is itself visible: motion stopping dead along a line reads as a seam,
 * which is a worse artefact than the motion it was preventing.
 */
const EDGE_RAMP = [0.1, 0.4] as const;

export type ProtectedRegion = { x: number; y: number; radius: number };

/**
 * Builds the mask.
 *
 * Returns `MASK_SIZE²` bytes, 0 (free to move) to 255 (frozen), ready to upload
 * as an R8 texture.
 */
export function buildProtectionMask(
  edgeField: Float32Array,
  edgeSize: number,
  textField: Float32Array,
  textGrid: number,
  region: ProtectedRegion | null,
): Uint8Array {
  const cells = MASK_SIZE * MASK_SIZE;
  const protect = new Float32Array(cells);

  /*
   * Downsampled by maximum, not by average.
   *
   * Averaging is the obvious choice and the wrong one: a single 2px stroke
   * inside a 4×4 patch averages down to a quarter of its strength and stops
   * protecting the glyph it belongs to. Taking the maximum means any strong
   * gradient anywhere in the patch protects all of it, which is also a free
   * first round of dilation — the margin the mask needs anyway, because
   * displacing a pixel *next* to a glyph still smears its antialiased edge.
   */
  const ratio = edgeSize / MASK_SIZE;

  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      const x0 = Math.floor(x * ratio);
      const y0 = Math.floor(y * ratio);
      const x1 = Math.min(edgeSize, Math.floor((x + 1) * ratio));
      const y1 = Math.min(edgeSize, Math.floor((y + 1) * ratio));

      let peak = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const value = edgeField[sy * edgeSize + sx];
          if (value > peak) peak = value;
        }
      }

      protect[y * MASK_SIZE + x] = smoothstep(EDGE_RAMP[0], EDGE_RAMP[1], peak);
    }
  }

  // The text field covers the whole of a word, including the background between
  // its strokes, which has no gradient and would otherwise be left free to move
  // inside a region whose strokes are frozen. Moving the gaps but not the ink
  // is worse than moving neither.
  if (textGrid > 0) {
    const textRatio = textGrid / MASK_SIZE;
    for (let y = 0; y < MASK_SIZE; y += 1) {
      const ty = Math.min(textGrid - 1, Math.floor(y * textRatio));
      for (let x = 0; x < MASK_SIZE; x += 1) {
        const tx = Math.min(textGrid - 1, Math.floor(x * textRatio));
        const i = y * MASK_SIZE + x;
        protect[i] = Math.max(protect[i], unit(textField[ty * textGrid + tx] * 2.2));
      }
    }
  }

  if (region) paintRegion(protect, region);

  return blur(dilate(protect));
}

/**
 * Freezes a detected face, with a soft outer edge.
 *
 * Nothing in this engine was ever going to morph a face — no displacing module
 * can reach one through the gradient term above, because a face is all
 * gradient. This exists for the parts around it that are not: a cheek, a
 * forehead, an out-of-focus shoulder. Those are smooth, so the gradient term
 * leaves them free, and a light field drifting across a smooth cheek while the
 * eyes beside it hold still is precisely the uncanny result the rules forbid.
 *
 * The falloff runs over the outer 35% of the radius. A hard circle would put a
 * visible ring on the artwork wherever motion stopped.
 */
function paintRegion(protect: Float32Array, region: ProtectedRegion): void {
  const inner = region.radius * 0.65;

  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      const dx = (x + 0.5) / MASK_SIZE - region.x;
      const dy = (y + 0.5) / MASK_SIZE - region.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance >= region.radius) continue;

      const strength = 1 - smoothstep(inner, region.radius, distance);
      const i = y * MASK_SIZE + x;
      if (strength > protect[i]) protect[i] = strength;
    }
  }
}

/**
 * One cell of margin in every direction.
 *
 * At 64² against a 640px texture a cell is ten display pixels, so this adds a
 * ten-pixel skirt around everything protected. Displacement is at most three
 * pixels, so the skirt is comfortably wider than anything that could reach
 * across it — deliberately, because over-protection costs only stillness in
 * regions that are busy anyway, and under-protection costs a smeared glyph.
 */
function dilate(source: Float32Array): Float32Array {
  const out = new Float32Array(source.length);

  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      let peak = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const sy = y + dy;
        if (sy < 0 || sy >= MASK_SIZE) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = x + dx;
          if (sx < 0 || sx >= MASK_SIZE) continue;
          const value = source[sy * MASK_SIZE + sx];
          if (value > peak) peak = value;
        }
      }
      out[y * MASK_SIZE + x] = peak;
    }
  }

  return out;
}

/**
 * A 3×3 box blur, and the conversion to bytes.
 *
 * Dilation leaves square corners, and a square corner in a mask is a square
 * corner in the motion field — the eye finds axis-aligned boundaries in
 * organic movement immediately. Softening them is what keeps the transition
 * between moving and still parts of the artwork from being the most noticeable
 * thing on screen.
 */
function blur(source: Float32Array): Uint8Array {
  const out = new Uint8Array(source.length);

  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const sy = y + dy;
        if (sy < 0 || sy >= MASK_SIZE) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = x + dx;
          if (sx < 0 || sx >= MASK_SIZE) continue;
          sum += source[sy * MASK_SIZE + sx];
          n += 1;
        }
      }
      out[y * MASK_SIZE + x] = Math.round(unit(sum / n) * 255);
    }
  }

  return out;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 === edge0) return value < edge0 ? 0 : 1;
  const t = unit((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
