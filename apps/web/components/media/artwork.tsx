'use client';

import { radiusForArtwork } from '@cue/design';
import Image from 'next/image';
import { useState } from 'react';

type ArtworkProps = {
  src: string | null;
  alt: string;
  /** Rendered edge length in px. Drives both layout and corner radius. */
  size: number;
  /** Above-the-fold artwork should not lazy-load. */
  priority?: boolean;
  className?: string;
  /**
   * Fill the parent instead of claiming a fixed box.
   *
   * For artwork whose size is animated by a parent — the player's cover
   * travelling between mini and full. `size` still sets the requested image
   * resolution and the corner radius; it just stops dictating layout, which
   * would otherwise override the animated dimensions.
   */
  fill?: boolean;
  /**
   * Take the width of the column and stay square.
   *
   * For artwork in a fluid grid, where the track width is decided by the
   * layout and not by us. `size` keeps its other two jobs — the resolution
   * asked of the CDN, and the corner radius — but stops dictating geometry.
   *
   * This exists because passing `className="w-full"` *looks* like it does the
   * same thing and cannot: the fixed width is an inline style, and no class
   * outranks one. The catalogue grid on Home was laying out 200px covers in
   * 157px columns because of it, overflowing every viewport under ~430px —
   * silently, since the tile's own `overflow-hidden` hid the evidence one
   * level too low to matter. A prop makes the choice explicit and impossible
   * to lose to the cascade.
   */
  responsive?: boolean;
  /**
   * `sizes` for the responsive case, describing the rendered width at each
   * breakpoint. Without it the browser assumes 100vw and downloads a cover
   * several times larger than any grid cell.
   */
  sizes?: string;
};

/**
 * Podcast artwork.
 *
 * Three things this gets right that a bare `<img>` does not:
 *
 *  - **No layout shift.** The box is sized before the image exists, so a slow
 *    CDN never reflows the list underneath it.
 *  - **No flash.** The image fades in over its own placeholder rather than
 *    popping in, and the placeholder is a flat surface tone rather than a
 *    spinner — a grid of spinners is visual noise, not feedback.
 *  - **A real fallback.** Feeds omit artwork often enough that "broken image
 *    icon" is a state users would actually see.
 */
export function Artwork({
  src,
  alt,
  size,
  priority = false,
  className,
  fill = false,
  responsive = false,
  sizes,
}: ArtworkProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(
    src ? 'loading' : 'failed',
  );

  // A new URL is a new image; the last verdict belongs to the last picture.
  // Adjusting state during render (React's endorsed pattern) resets before
  // anything paints, so a swapped src never inherits loaded/failed.
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setState('loading');
  }

  const radius = radiusForArtwork(size);

  // `aspect-ratio` rather than a padding-box hack: it reserves the height
  // before the image exists just as reliably, and it survives the box being
  // handed an explicit width by a grid track.
  const box = fill
    ? { width: '100%', height: '100%', borderRadius: 'inherit' }
    : responsive
      ? { width: '100%', aspectRatio: '1 / 1', borderRadius: radius }
      : { width: size, height: size, borderRadius: radius };

  return (
    <div
      className={[
        'relative overflow-hidden bg-[var(--color-skeleton)]',
        // A responsive cover must be allowed to shrink; `shrink-0` is what
        // keeps a fixed one from being squeezed by a flex row beside it.
        responsive ? '' : 'shrink-0',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={box}
    >
      {src && state !== 'failed' ? (
        <Image
          src={src}
          alt={alt}
          width={size}
          height={size}
          priority={priority}
          // Below the fold, let the browser decide — it schedules this better
          // than any scroll listener we could write.
          loading={priority ? 'eager' : 'lazy'}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className="h-full w-full object-cover transition-opacity duration-[var(--duration-base)] ease-enter"
          style={{ opacity: state === 'loaded' ? 1 : 0 }}
          // Artwork is square and displayed at a known size, so the browser
          // never has to guess which candidate to download. A responsive cover
          // has no single known size, so the caller describes it instead —
          // falling back to the nominal one rather than to 100vw, which is the
          // browser's default and would fetch a full-width image for a tile.
          sizes={responsive ? (sizes ?? `${size}px`) : `${size}px`}
        />
      ) : null}

      {state === 'failed' ? <ArtworkFallback alt={alt} size={size} /> : null}

      {/* A hairline inset border keeps pale artwork from bleeding into a pale
          background without drawing a heavy frame around every cover. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          borderRadius: fill ? 'inherit' : radius,
          boxShadow: 'inset 0 0 0 1px var(--color-border)',
        }}
      />
    </div>
  );
}

/** The show's initial, centred. Recognisable at 44px, unlike a broken icon. */
function ArtworkFallback({ alt, size }: { alt: string; size: number }) {
  const initial = alt.trim().charAt(0).toUpperCase() || '?';

  return (
    <div
      className="flex h-full w-full items-center justify-center bg-[var(--color-surface-raised)] text-[var(--color-text-tertiary)]"
      aria-hidden="true"
    >
      <span
        style={{ fontSize: Math.max(12, Math.round(size * 0.34)), fontWeight: 600 }}
      >
        {initial}
      </span>
    </div>
  );
}
