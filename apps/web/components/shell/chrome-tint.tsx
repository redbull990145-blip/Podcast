import { tintedSchemeCss } from '@cue/design';

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
  /*
    Both themes, not just the dark one — and this is the component where getting
    that wrong was most visible.

    `tintedScheme` used to return a dark palette whatever the listener had
    chosen, and this rule paints the rail, the tab bar and the content gutter.
    So opening any show while on the light theme repainted the entire window
    dark and left it that way until you navigated somewhere untinted: choosing
    Light and then tapping a podcast was indistinguishable from the setting
    having failed to save.

    `tintedSchemeCss` emits the light palette alongside the dark one and lets
    the stylesheet choose, which is the only mechanism available here — this
    renders on the server, and the theme is not known until a blocking script
    reads localStorage on the client. Interpolation safety is covered there.
  */
  const css = color ? tintedSchemeCss(color, '[data-chrome-tint]') : null;
  if (!css) return null;

  return <style>{css}</style>;
}
