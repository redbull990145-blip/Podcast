'use client';

import { Artwork } from '@/components/media/artwork';

/**
 * A playlist's cover: the first few episodes' artwork, tiled.
 *
 * A collection needs to look like one. A single cover makes a playlist
 * indistinguishable from an episode, and a generic folder glyph makes it
 * indistinguishable from every other playlist — the artwork *is* the
 * recognition, which is why the API ships four URLs rather than making the
 * client fetch each playlist's contents to draw a tile.
 *
 * Degrades honestly: four covers tile 2×2, one fills the square, and none draws
 * the empty frame rather than a placeholder pretending to be artwork.
 */
export function CoverStack({
  artworkUrls,
  title,
  size,
}: {
  artworkUrls: string[];
  title: string;
  size: number;
}) {
  const covers = artworkUrls.slice(0, 4);

  if (covers.length === 0) {
    return (
      <div
        aria-hidden="true"
        className="shrink-0 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-raised)]"
        style={{ width: size, height: size }}
      />
    );
  }

  if (covers.length < 4) {
    return <Artwork src={covers[0] ?? null} alt={title} size={size} />;
  }

  return (
    <div
      className="grid shrink-0 grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-border)]"
      style={{ width: size, height: size }}
    >
      {covers.map((url, index) => (
        // Index as key: these are four positions in a fixed grid, not a list
        // that reorders, and two episodes of the same show share a cover URL.
        <div key={`${url}-${index}`} className="relative overflow-hidden">
          {/* `fill` so each quadrant is exactly a quarter of the tile rather
              than a fixed box that would round its own corners inside one. */}
          <Artwork src={url} alt="" size={Math.round(size / 2)} fill />
        </div>
      ))}
    </div>
  );
}
