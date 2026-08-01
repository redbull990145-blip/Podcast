/**
 * Oklab, and the operations that make colour fidelity structural.
 *
 * Every colour adjustment in this engine happens here rather than in RGB, for
 * one reason: **in RGB there is no such thing as "slightly toward that
 * colour".** Interpolating red toward blue in sRGB passes through a dead
 * magenta-grey; brightening a colour by scaling its channels desaturates it;
 * adding a warm tint shifts hue as well as temperature. Any of those, applied
 * at even a few percent, reads as the artwork having been *altered* rather than
 * lit.
 *
 * Oklab is perceptually uniform, so a small step is a small perceived change in
 * every direction, and its axes are the ones the modules actually want to move
 * along: `L` is lightness with chroma held, `a`/`b` are chroma with lightness
 * held. That is what lets a "breathing luminance" module change brightness
 * without touching colour, and a "colour flow" module change colour without
 * touching brightness.
 *
 * It is also cheap — two 3×3 matrices and a cube root each way — and, being
 * analytically invertible, a round trip costs less than a thousandth of an
 * 8-bit level. That matters: at zero intensity the shader must be an identity
 * function, and it is only identity if the conversion out undoes the conversion
 * in exactly.
 */
export const OKLAB_GLSL = /* glsl */ `
// --- sRGB transfer function -------------------------------------------------
//
// Oklab is defined over *linear* light. Skipping the transfer function and
// feeding it gamma-encoded values is the single most common way to get Oklab
// wrong: it still produces plausible-looking output, which is why it survives
// review, but lightness stops being lightness and every "hold L constant"
// operation quietly changes brightness.

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

// --- Oklab ------------------------------------------------------------------

vec3 srgbToOklab(vec3 srgb) {
  vec3 c = srgbToLinear(srgb);

  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;

  // Non-negative for anything in gamut, so a plain cube root is safe; the max()
  // guards against a denormal arriving from a filtered texture fetch.
  float l_ = pow(max(l, 0.0), 1.0 / 3.0);
  float m_ = pow(max(m, 0.0), 1.0 / 3.0);
  float s_ = pow(max(s, 0.0), 1.0 / 3.0);

  return vec3(
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  );
}

vec3 oklabToSrgb(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;

  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;

  return linearToSrgb(vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ));
}

// --- operations the modules are allowed to use ------------------------------

/**
 * Moves a colour toward a target, in colour only.
 *
 * The lightness of the result is the lightness of the original, always. This is
 * the operation behind every chroma module, and restricting it this way is what
 * keeps "colour flow" from turning into "the artwork got brighter" — and, more
 * importantly, it is why the modules can only ever produce colours that lie
 * between the artwork's own and one of its own extracted swatches. A hue the
 * cover does not contain is not reachable from here.
 */
vec3 towardColour(vec3 lab, vec3 targetLab, float amount) {
  return vec3(lab.x, mix(lab.yz, targetLab.yz, amount));
}

/** Scales chroma about the neutral axis, holding hue and lightness. */
vec3 scaleChroma(vec3 lab, float factor) {
  return vec3(lab.x, lab.yz * factor);
}

/** Adds lightness. Separate from the above so a module has to choose one. */
vec3 addLightness(vec3 lab, float amount) {
  return vec3(lab.x + amount, lab.yz);
}

/** Distance from the neutral axis: how colourful this pixel is, 0 upward. */
float chroma(vec3 lab) {
  return length(lab.yz);
}
`;
