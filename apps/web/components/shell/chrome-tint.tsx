import { colorVarStyle, tintedScheme } from '@cue/design';

/**
 * Repaint the app's chrome in the colour of the page it is standing next to.
 *
 * A podcast page takes over the whole content area with a ground derived from
 * its cover. That looked right on its own and wrong in the window: a deep navy
 * page with a cream navigation rail welded to its edge, and a cream player bar
 * across the bottom, reads as two applications sharing a screen rather than one
 * app showing you a record. The colour has to reach the frame or it should not
 * be there at all.
 *
 * **Emitted as a stylesheet rather than passed as props**, because the chrome is
 * not below the page in the tree — it is above it. The rail and the player live
 * in the shell so that navigation replaces only the content area and playback
 * survives a route change, which means no page can hand them anything. A style
 * element can be rendered from here, on the server, in the same response as the
 * page it belongs to: no prop drilling, no client store, and — the part that
 * matters — no flash, because the rule is in the document before the first
 * paint rather than applied by an effect after it.
 *
 * It unmounts with the page, so navigating away restores the theme's own chrome
 * with no cleanup to forget.
 */
export function ChromeTint({ color }: { color: string | null }) {
  const scheme = color ? tintedScheme(color) : null;
  if (!scheme) return null;

  /*
    Safe to interpolate, and worth saying why rather than leaving it to be
    rediscovered nervously.

    `color` originates from a publisher's artwork, which is attacker-adjacent
    data — but it never reaches this string. `tintedScheme` parses it through
    `hexToRgb`, which accepts six hex digits and nothing else, and returns
    `null` otherwise; everything below is a value this codebase *generated* from
    the parsed numbers. There is no path by which a feed can put a `}` in here.
  */
  const declarations = Object.entries(colorVarStyle(scheme))
    .map(([property, value]) => `${property}:${value}`)
    .join(';');

  return (
    <style>{`[data-chrome-tint]{${declarations}}`}</style>
  );
}
