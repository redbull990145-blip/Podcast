'use client';

import { resolvePlaylistPalette } from '@cue/design';
import type { PlaylistBanner as Banner } from '@cue/types';

/**
 * A playlist's banner.
 *
 * Either a palette gradient or a picture the owner uploaded, with an optional
 * line of text over it. One component for both because the text has to sit
 * identically either way — someone who writes a caption, uploads a photo, and
 * then switches back to a colour should see their caption stay exactly where
 * they put it.
 *
 * The text is drawn over a scrim rather than over the artwork directly. A
 * photograph is not a background you can predict: the same white caption that
 * reads cleanly over a dark album cover vanishes over a snowfield, and no
 * amount of choosing the right text colour fixes an image that is bright in one
 * corner and black in the other.
 */
export function PlaylistBanner({
  banner,
  title,
  height = 200,
  rounded = true,
}: {
  banner: Banner;
  /** Read aloud in place of the picture. The banner itself is decoration. */
  title: string;
  height?: number;
  rounded?: boolean;
}) {
  const palette = resolvePlaylistPalette(banner.color);
  const showsImage = banner.kind === 'image' && banner.imageUrl !== null;

  return (
    <div
      className={`relative isolate w-full overflow-hidden ${
        rounded ? 'rounded-[var(--radius-lg)]' : ''
      }`}
      style={{
        height,
        // The gradient is the base layer whichever kind is showing. While a
        // picture is still loading it is what fills the space, so the header
        // never flashes an empty grey box on the way in.
        background: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
      }}
    >
      {showsImage ? (
        /*
          A plain <img>, not next/image.

          The optimiser would need this origin in `remotePatterns`, and the
          bytes are already the exact size and format the server decided —
          re-encoding a 1600×500 WebP through a second pipeline is work that
          can only make it worse.
        */
        <img
          src={banner.imageUrl ?? ''}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          // The banner is below the fold on no screen this app has; waiting for
          // an intersection observer would just delay it.
          loading="eager"
          decoding="async"
        />
      ) : null}

      {banner.text ? (
        <>
          {/* Bottom-weighted so the scrim covers the text and little else —
              a full-bleed overlay would mute a picture someone chose. */}
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-3/5"
            style={{
              background:
                'linear-gradient(to top, rgba(0,0,0,0.62), rgba(0,0,0,0.28) 45%, transparent)',
            }}
          />
          <p
            className="type-title2 absolute inset-x-0 bottom-0 m-0 px-5 pb-4 text-balance"
            style={{
              // White over the scrim rather than the palette's `onBanner`: the
              // scrim is the surface here, and it is black in both themes and
              // under every photograph.
              color: '#FFFFFF',
              textShadow: '0 1px 2px rgba(0,0,0,0.4)',
            }}
          >
            {banner.text}
          </p>
        </>
      ) : null}

      <span className="sr-only">{title}</span>
    </div>
  );
}
