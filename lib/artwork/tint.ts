"use client";

/**
 * Borrows a hero surface's colour from the artwork sitting on it.
 *
 * The visual argument: a cover is the only genuinely saturated object most of
 * these screens contain, and a large card holding one reads as a generic
 * container wearing an image unless something in the surface acknowledges it.
 * Bleeding a little of the cover's own colour into the panel behind it is what
 * makes the two look like one object.
 *
 * This deliberately does *not* extract its own palette. `extractArtworkPalette`
 * in lib/player/artwork-palette.ts already does the work, already caches per
 * URL for the session, and already de-duplicates concurrent requests for the
 * same image — so a hero and the Now Playing backdrop showing the same cover
 * cost one k-means pass between them, not two. Running a second extractor here
 * would be both wasteful and capable of disagreeing with the first, which would
 * show up as a hero tinted a visibly different colour from the player.
 *
 * It takes `mesh[0]` rather than `glow` or `base` because mesh colours have
 * already been through `matteTone`: saturation clamped to 0.32–0.58 and
 * lightness to 0.2–0.42. That clamp is exactly the chroma guard a tint needs.
 * A cover with a fully-saturated primary — a logo, a text card — would
 * otherwise paint a warning-light wash across a panel and break the matte rule
 * the whole palette is built on. Reusing the existing clamp means the rule is
 * enforced in one place rather than restated here in slightly different terms.
 */

import { useEffect, useState } from "react";
import { extractArtworkPalette } from "@/lib/player/artwork-palette";

/**
 * The channel triple handed to CSS, e.g. `"76 72 104"`.
 *
 * Space-separated and without the `rgb()` wrapper so the stylesheet can put it
 * through `rgb(var(--tint-rgb) / <alpha>)` at several different opacities. A
 * finished colour could not be re-alphaed without `color-mix`, and could not be
 * reinterpreted per theme at all.
 */
export type TintChannels = string;

/** Style object for a hero container. Spread onto `style`. */
export type TintStyle = React.CSSProperties & { "--tint-rgb"?: TintChannels };

/**
 * `rgb(76, 72, 104)` → `"76 72 104"`.
 *
 * Returns null rather than throwing on anything unexpected. This is decoration
 * on a decorative subsystem, and the CSS fallback is already the accent, so
 * every failure path here should end in "the hero looks like the rest of the
 * app" and not in a broken custom property that paints `rgb( / 0.16)`.
 */
export function channelsFromRgb(value: string | undefined): TintChannels | null {
  if (!value) return null;
  const match = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (!match) return null;

  const channels = [match[1], match[2], match[3]].map(Number);
  if (channels.some((c) => !Number.isFinite(c) || c < 0 || c > 255)) return null;

  return channels.join(" ");
}

/** Builds the inline style, or an empty object so the CSS fallback applies. */
export function tintStyle(channels: TintChannels | null): TintStyle {
  return channels ? { "--tint-rgb": channels } : {};
}

/**
 * Resolves the tint for a piece of artwork.
 *
 * Returns an empty style until the palette arrives, which is the correct
 * default rather than a loading state: the accent fallback in globals.css is
 * already a finished-looking surface, so there is nothing to hide and no reason
 * to hold the hero back on a colour it does not need to render.
 *
 * The tint is *not* transitioned when it changes. A wash that animates between
 * two hues draws the eye to the background of a card at exactly the moment the
 * user is trying to read the new title in front of it — and because artwork
 * resolves within a frame or two of the image itself, there is almost never a
 * visible before-state to transition from.
 */
export function useArtworkTint(src: string | null | undefined): TintStyle {
  const [channels, setChannels] = useState<TintChannels | null>(null);

  useEffect(() => {
    if (!src) {
      setChannels(null);
      return;
    }

    // Guards against a fast cover switch resolving out of order and leaving the
    // hero tinted from the previous episode.
    let active = true;

    extractArtworkPalette(src).then((palette) => {
      if (!active) return;
      setChannels(channelsFromRgb(palette?.mesh[0]));
    });

    return () => {
      active = false;
    };
  }, [src]);

  return tintStyle(channels);
}
