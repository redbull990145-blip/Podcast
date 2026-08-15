'use client';

import { deriveTint } from '@cue/design';
import { useMemo } from 'react';

/**
 * The background, taken from the artwork itself.
 *
 * Two layers, because neither alone is right.
 *
 * The **cover, blurred to nothing**, is the honest one: it carries the actual
 * colours of the actual image in the actual proportions they appear, including
 * the ones no single "dominant colour" could represent — the gold in a corner,
 * the cold grey along one edge. It is scaled well past the frame and blurred
 * hard, so what survives is colour and rough placement, never a recognisable
 * picture. No CORS problem: blurring an image is painting, and painting a
 * cross-origin image has always been allowed. Only *reading its pixels back*
 * is blocked, which is why the numeric colour is extracted on the server.
 *
 * The **tint wash** on top is what makes it usable. A blurred cover alone can
 * land anywhere — a white-background cover gives a glaring white screen, a
 * near-black one gives a void — so a wash derived from the extracted colour is
 * laid over it and the whole thing sits on a dark base. That fixes the floor
 * and the ceiling: text contrast stops depending on which cover happens to be
 * playing, which is the difference between a mood and an accessibility bug.
 *
 * Deliberately still. Apple's version drifts; a slow-moving gradient behind
 * text someone is reading is exactly the kind of ambient motion that has no
 * information in it, and the motion policy says movement has to mean something.
 */
/**
 * The image to blur, routed through Next's optimiser at a deliberately tiny size.
 *
 * 64 pixels is not a compromise here — it is the correct input. The layer is
 * blurred by 72px and scaled 1.8×, so every high-frequency detail in a 3000px
 * cover is destroyed before it reaches a screen; fetching one to throw it away
 * would cost megabytes to produce a result indistinguishable from this. The
 * optimiser also makes the request same-origin and cacheable, and returns a
 * URL with no quotes or backslashes in it, so it cannot break out of `url(...)`
 * — publisher artwork URLs are attacker-adjacent data and go through
 * `encodeURIComponent` on the way in.
 */
function blurSource(artworkUrl: string): string {
  return `/_next/image?url=${encodeURIComponent(artworkUrl)}&w=64&q=75`;
}

export function AmbientBackdrop({
  artworkUrl,
  accentColor,
}: {
  artworkUrl: string | null;
  /** `#RRGGBB` from the server. Null is normal — the wash simply goes neutral. */
  accentColor: string | null;
}) {
  const tint = useMemo(
    () => (accentColor ? deriveTint(accentColor, 'dark') : null),
    [accentColor],
  );

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* The base. Painted first so a missing or slow cover is a dark screen
          rather than a white flash. */}
      <div className="absolute inset-0 bg-[var(--color-bg)]" />

      {artworkUrl ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${blurSource(artworkUrl)})`,
            // Scaled up and pushed off its own edges so the blur has material
            // to work with — a blur applied inside the frame samples the page
            // background at the borders and leaves a pale halo around the edge.
            //
            // `translateZ(0)` is not cargo cult here, and it is the difference
            // between this screen running at frame rate and not. A 72px blur
            // over the full viewport is expensive to produce *once*; the player
            // fades this whole backdrop in behind an opacity animation, and an
            // un-promoted subtree is re-rasterised on every frame of that fade
            // — so the most expensive thing on the screen was being redrawn
            // sixty times to accomplish one appearance. Promoted, it is
            // rasterised once and the compositor fades the finished texture.
            transform: 'scale(1.8) translateZ(0)',
            filter: 'blur(72px) saturate(1.6)',
            opacity: 0.55,
            // Nothing inside affects layout outside it, so the browser can skip
            // this subtree entirely when anything else on the sheet changes.
            contain: 'paint',
          }}
        />
      ) : null}

      {/* The wash. `fill` at low alpha rather than the token's own wash: this
          has to survive on top of an image, where a near-transparent tone does
          nothing at all. */}
      {tint ? (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(120% 90% at 30% 0%, ${tint.fill}55 0%, transparent 70%)`,
          }}
        />
      ) : null}

      {/*
        The legibility floor.

        A gradient rather than a flat scrim, weighted toward the bottom where
        the controls and the timestamps live — those are small text on top of
        whatever the cover happened to be, and they are the first thing to
        become unreadable when a bright cover comes up.
      */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgb(0 0 0 / 0.30) 0%, rgb(0 0 0 / 0.45) 45%, rgb(0 0 0 / 0.72) 100%)',
        }}
      />
    </div>
  );
}
