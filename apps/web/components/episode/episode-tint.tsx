'use client';

import { queryKeys } from '@cue/api-client';
import { deriveTint } from '@cue/design';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '@/lib/api';

/**
 * The colour wash behind an episode's header.
 *
 * Rendered on the server with whatever colour is already known — the episode's
 * if it has been played before, the show's otherwise — and upgraded here once
 * the episode's own artwork has been sampled.
 *
 * Split from the page for one reason: extracting a colour means the server
 * fetching an image from a publisher's CDN, and no page should wait on that to
 * paint. Doing it from the client also keeps the extraction billed to the
 * person who opened the page rather than to the rendering server, which shares
 * one address across every visitor and would exhaust the rate limit in seconds.
 *
 * The transition covers the swap. It is slow and it is opacity-adjacent by
 * nature — a background colour easing from one to another — so it stays under
 * reduced motion, where an abrupt repaint would be the more jarring option.
 */
export function EpisodeTint({
  episodeId,
  initialColor,
}: {
  episodeId: string;
  /** What the server already knew. Null renders nothing at all. */
  initialColor: string | null;
}) {
  const { data } = useQuery({
    queryKey: queryKeys.episode.tint(episodeId),
    queryFn: ({ signal }) => api.getEpisodeTint(episodeId, { signal }),
    // A cover's colour does not change once extracted.
    staleTime: Infinity,
    gcTime: Infinity,
    // The page already has a colour. A retry storm against an image CDN having
    // a bad day would buy nothing anybody can see.
    retry: false,
  });

  const color = data?.accentColor ?? initialColor;
  const tint = useMemo(() => (color ? deriveTint(color, 'dark') : null), [color]);

  if (!tint) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-[300px] transition-[background] duration-[var(--duration-slow)] ease-standard sm:h-[380px]"
      style={{
        background: `linear-gradient(to bottom, ${tint.wash} 0%, transparent 100%)`,
        zIndex: 0,
      }}
    />
  );
}
