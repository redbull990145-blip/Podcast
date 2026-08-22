/**
 * Blending two CSS colours, for animating a palette.
 *
 * Exists because CSS cannot do it for us here. Custom properties are
 * *unregistered* by default, which makes them untyped strings as far as the
 * cascade is concerned — a `transition` on one is ignored outright, because the
 * engine has no idea that `#2A2419` and `#1D2A2E` are two points on a line
 * rather than two unrelated tokens. `@property` would fix that, and would mean
 * declaring all twenty-two of them with an `initial-value` apiece and accepting
 * that every future palette variable has to be registered too or it silently
 * stops animating. Interpolating here keeps the palette a plain object and the
 * animation in one place.
 *
 * **sRGB, not OKLab**, which is the opposite of the choice the design package
 * makes everywhere else — and deliberate. OKLab is right for *deriving* a
 * palette, where the question is what a colour means perceptually. This is a
 * two-second crossfade between two palettes that were each already fitted in
 * OKLab, so the endpoints are correct by construction and the only question is
 * what happens in between. Down that path the two are near-indistinguishable
 * at 60fps, and sRGB costs no conversion per frame per variable.
 */

/** Red, green, blue in 0–255, alpha in 0–1. */
type Rgba = { r: number; g: number; b: number; a: number };

/**
 * Parse the two forms these palettes actually contain.
 *
 * Hex — `#RGB`, `#RRGGBB`, `#RRGGBBAA` — and `rgb()`/`rgba()`, which is what
 * the schemes use for the translucent hover and border washes. Anything else
 * returns null and the caller snaps rather than guessing, because a palette
 * half-interpolated and half-snapped is worse than one that simply changes.
 */
export function parseColor(input: string): Rgba | null {
  const value = input.trim();

  if (value.startsWith('#')) {
    const hex = value.slice(1);

    // `#abc` → `#aabbcc`. Doubling each digit is the actual definition, not an
    // approximation of it: `#f` means `0xff`, not `0xf0`.
    const full =
      hex.length === 3 || hex.length === 4
        ? hex
            .split('')
            .map((digit) => digit + digit)
            .join('')
        : hex;

    if (full.length !== 6 && full.length !== 8) return null;

    const int = Number.parseInt(full, 16);
    if (Number.isNaN(int)) return null;

    return full.length === 6
      ? { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255, a: 1 }
      : {
          r: (int >>> 24) & 255,
          g: (int >>> 16) & 255,
          b: (int >>> 8) & 255,
          a: (int & 255) / 255,
        };
  }

  const match = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (!match) return null;

  // Both the legacy comma syntax and the modern space syntax, since either can
  // arrive depending on who wrote the token.
  const parts = match[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;

  return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
}

function toCss({ r, g, b, a }: Rgba): string {
  const channel = (value: number) => Math.round(Math.min(255, Math.max(0, value)));
  return a >= 1
    ? `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`
    : `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${Math.min(1, Math.max(0, a)).toFixed(3)})`;
}

/**
 * `from` at t=0, `to` at t=1.
 *
 * Falls back to a hard switch at the halfway mark when either end cannot be
 * parsed — the change still happens, it just happens once, under whatever else
 * is moving at the time.
 */
export function lerpColor(from: string, to: string, t: number): string {
  const a = parseColor(from);
  const b = parseColor(to);

  if (!a || !b) return t < 0.5 ? from : to;

  return toCss({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  });
}
