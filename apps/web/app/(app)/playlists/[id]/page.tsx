import type { Metadata } from 'next';
import { PlaylistClient } from './playlist-client';

/**
 * A playlist is private, so its name never reaches the document head.
 *
 * The title would otherwise leak into browser history, a shared screen, and
 * every "recently visited" surface the OS keeps — for a page nobody but its
 * owner can load anyway.
 */
export const metadata: Metadata = { title: 'Playlist' };

type Params = { params: Promise<{ id: string }> };

export default async function PlaylistPage({ params }: Params) {
  const { id } = await params;

  // No wrapper here: `PlaylistClient` owns its own outer element now, because
  // a playlist with a page colour has to repaint `<main>`'s own background —
  // see `ChromeTint` in that file — which only works from the element that is
  // actually going to carry `data-chrome-tint`, not from a div a level above it
  // that has already decided the page's padding and can't be un-decided later.
  return <PlaylistClient playlistId={id} />;
}
