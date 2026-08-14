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
}: ArtworkProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(
    src ? 'loading' : 'failed',
  );

  const radius = radiusForArtwork(size);

  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-[var(--color-skeleton)] ${className ?? ''}`}
      style={
        fill
          ? { width: '100%', height: '100%', borderRadius: 'inherit' }
          : { width: size, height: size, borderRadius: radius }
      }
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
          // never has to guess which candidate to download.
          sizes={`${size}px`}
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
