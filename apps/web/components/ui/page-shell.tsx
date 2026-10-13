import type { ReactNode } from 'react';

/**
 * The frame every screen sits in.
 *
 * This was nine copies of the same class string — `mx-auto w-full
 * max-w-[var(--measure-content)] px-5 py-8 md:px-10 md:py-12` — written out by
 * hand in Home, Search, Library, Playlists, the playlist detail, the podcast
 * page and the episode page. Two of the nine had already drifted: Settings and
 * Queue carried `py-10` with no `md:py-12`, so those two screens started their
 * content eight pixels higher than every other on a desktop and eight lower on
 * a phone. Nobody chose that; it is what nine copies of a number do.
 *
 * A component rather than a Tailwind `@utility`, because the width cap is a
 * *decision* — see `width` — and a class name cannot be given a type.
 */
export function PageShell({
  width = 'content',
  className,
  children,
}: {
  /**
   * Which cap the page takes.
   *
   * `content` (1440) is the frame for anything with artwork in it: a grid of
   * covers past that width stops being a grid and starts being a wall. `wide`
   * (1680) is for screens that are mostly *rows* — the queue, and search
   * results — where the extra 240px goes into the title rather than into
   * another column.
   *
   * The distinction is the whole reason this takes a prop. `--measure-wide`
   * existed and was reachable from exactly one screen: Search asked for it on
   * its results list, inside a parent already capped at `--measure-content`,
   * and a child cannot be wider than its parent — so the token silently did
   * nothing on the one page that named it. Putting the cap on the frame is
   * what makes the answer a page can actually give.
   */
  width?: 'content' | 'wide';
  /** For pages that establish their own positioning context — a tinted room. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={[
        'mx-auto w-full px-5 py-8 md:px-10 md:py-12',
        width === 'wide'
          ? 'max-w-[var(--measure-wide)]'
          : 'max-w-[var(--measure-content)]',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
