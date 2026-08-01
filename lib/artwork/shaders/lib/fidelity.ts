/**
 * The guarantee that the artwork is never modified.
 *
 * "Do not modify the artwork" and "do not reduce image quality" are the two
 * rules that a blend weight cannot honour, because a blend weight is a number
 * someone can raise. This is the alternative: **the last thing the fragment
 * shader does before writing out is clamp its result to within a fixed distance
 * of the pixel it started from.**
 *
 * Whatever the modules computed, however a profile was configured, whatever
 * intensity the user chose — the output is bounded. The deviation is enforced by
 * the compiler rather than by discipline, and at zero intensity the bound is
 * zero, which makes the shader an identity function and gives the engine a
 * mechanically verifiable acceptance test.
 *
 * The clamp is applied against the **undisplaced** source pixel, which has a
 * consequence worth stating: it bounds the visible effect of displacement too.
 * A parallax shift across a smooth background moves the colour barely at all and
 * passes through untouched; the same shift across a hard edge would move it a
 * great deal and is clipped back. Depth therefore self-limits to exactly the
 * regions where depth is invisible, which is what "extremely subtle depth
 * illusion, never obvious" asks for — arrived at as a property of the clamp
 * rather than as another constant to tune.
 */
export const FIDELITY_GLSL = /* glsl */ `
/**
 * Bounds a colour's deviation from its source, in Oklab.
 *
 * Lightness is bounded more tightly than chroma. The eye resolves lightness
 * differences several times more finely than it does hue at these magnitudes,
 * so an equal budget in all three axes spends most of the visible change on the
 * axis where it is most likely to be noticed — which is the opposite of what
 * this engine wants. Chroma gets the wider allowance, which is also where the
 * effect is worth having: a drift in colour temperature reads as light in a
 * room, while the same magnitude of lightness change reads as flicker.
 */
vec3 clampDeviation(vec3 srcLab, vec3 lab, float maxDelta) {
  vec3 limit = vec3(maxDelta, maxDelta * 1.8, maxDelta * 1.8);
  return srcLab + clamp(lab - srcLab, -limit, limit);
}

/**
 * The final write.
 *
 * Converts back to sRGB, adds a sub-level dither, and clamps to the displayable
 * range. Everything that reaches the framebuffer goes through here, so the
 * dither can never be forgotten by a module author.
 *
 * The dither is ±half a level. Enough to break up 8-bit banding on the very
 * smooth gradients these modules produce, small enough that it can never
 * register as noise on the artwork itself.
 */
vec3 resolve(vec3 lab, vec2 fragCoord) {
  vec3 rgb = oklabToSrgb(lab);
  rgb += (ditherNoise(fragCoord) - 0.5) / 255.0;
  return clamp(rgb, 0.0, 1.0);
}
`;
