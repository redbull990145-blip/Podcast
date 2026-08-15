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

  return (
    <div className="mx-auto w-full max-w-[var(--measure-content)] px-5 py-8 md:px-10 md:py-12">
      <PlaylistClient playlistId={id} />
    </div>
  );
}
