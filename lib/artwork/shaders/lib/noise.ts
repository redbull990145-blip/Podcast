/**
 * The noise the light fields are shaped by.
 *
 * Two requirements pull against each other here. The motion has to be organic —
 * no visible sine wave, no travelling wavefront, nothing that reads as a
 * pattern — and it has to be cheap enough to evaluate several times per
 * fragment at 60fps on a phone.
 *
 * Value noise with a smooth interpolant is the right trade. Gradient (Perlin)
 * noise is better looking at high frequencies, but everything here runs at very
 * low frequencies over a small quad, where the difference is invisible and the
 * extra dot products are not.
 *
 * **Movement comes from scrolling the field, not from oscillating an amplitude.**
 * A `sin(time)` term produces motion that returns to where it started, and the
 * eye finds the turning points. Translating through a 2D noise field along a
 * fixed heading never returns, so the light genuinely drifts rather than
 * swinging — and two layers scrolling on incommensurable headings compose into
 * something with no period at all. See `engine/clock.ts` for why the ratios
 * matter.
 */
export const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

/**
 * Value noise with a quintic interpolant.
 *
 * The quintic (6t⁵−15t⁴+10t³) rather than the usual smoothstep: its second
 * derivative is zero at the cell boundaries as well as its first, so there is no
 * discontinuity in acceleration where cells meet. At these amplitudes a
 * curvature seam would not be visible as a seam — it would be visible as the
 * light momentarily changing speed, which is exactly the "no sharp
 * acceleration" rule.
 */
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/**
 * Three octaves, normalised to 0–1.
 *
 * The division is not cosmetic. Summing octaves at 0.5, 0.25 and 0.125 gives a
 * theoretical maximum of 0.875, so the raw sum never reaches 1 — and because
 * the octaves are independent, the result clusters hard around its 0.4375 mean
 * rather than exploring the range. Callers that centred the raw sum on 0.5 were
 * getting excursions of roughly ±0.15 while being written as though they had
 * ±0.5, which made every light field about three times quieter than its
 * coefficient claimed. That was most of the reason the engine's motion was
 * invisible.
 *
 * Dividing by the maximum makes the output honest: 0–1, centred on 0.5.
 */
float fbm(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;

  for (int i = 0; i < 3; i++) {
    sum += valueNoise(p) * amplitude;
    // 2.03 rather than 2.0: an exact doubling makes successive octaves share
    // cell boundaries, which produces faint axis-aligned structure in the
    // result. An irrational-ish ratio scatters them.
    p *= 2.03;
    amplitude *= 0.5;
  }

  return sum / 0.875;
}

/**
 * A slowly evolving field, centred on zero.
 *
 * The drift vector is the heading the field scrolls along, and its components should
 * come from different entries in the rate table so the layers never realign.
 * Returns roughly −0.5 to 0.5.
 */
float driftField(vec2 uv, float scale, vec2 drift, float time) {
  return fbm(uv * scale + drift * time) - 0.5;
}

/**
 * Two fields at different scales and headings, composed.
 *
 * The large scale carries the movement the eye reads as light; the smaller one
 * breaks up its shape so it never resolves into a recognisable blob. Weighted
 * heavily toward the large one — the small field is texture, not motion.
 */
float lightField(vec2 uv, float time, vec2 slowDrift, vec2 fastDrift) {
  float broad = driftField(uv, 1.6, slowDrift, time);
  float fine = driftField(uv, 4.1, fastDrift, time);
  return broad * 0.75 + fine * 0.25;
}

/**
 * Domain warp: displaces the lookup by another noise field.
 *
 * This is what stops a light field looking like clouds. Warping the coordinates
 * before sampling turns the smooth blobs of plain fbm into the folded, wispy
 * structure that reads as light in a real room rather than as a texture.
 */
vec2 warp(vec2 uv, float time, float amount) {
  return uv + amount * vec2(
    fbm(uv * 2.2 + vec2(0.0, time * 0.06)),
    fbm(uv * 2.2 + vec2(5.2, 1.3 - time * 0.043))
  );
}

/**
 * Interleaved gradient noise, for dithering.
 *
 * Every module here works in fractions of an 8-bit level, and a smooth ramp
 * quantised to 8 bits bands visibly — which would be *reducing image quality*,
 * the one thing the engine must never do. A sub-level dither converts the
 * banding into noise below the threshold of vision, so the animated output is
 * fractionally cleaner than the static image rather than worse.
 *
 * Jorge Jimenez's constants: the cheapest function that produces a
 * well-distributed, non-tiling pattern in screen space.
 */
float ditherNoise(vec2 fragCoord) {
  return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}
`;
