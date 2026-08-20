import type { Translator } from '@cue/i18n';
import type { Route } from 'next';
import Link from 'next/link';

/**
 * Numbered paging for a show's archive.
 *
 * The episode list used to stop at thirty with a line reading "Showing the 30
 * most recent episodes" and no way to see the thirty-first. On a daily show
 * that is nine days of an eleven-year archive — the other 2,917 episodes
 * existed, were served by the API, and were unreachable from the interface.
 *
 * Numbers rather than "load more". A back catalogue is one of the very few
 * lists in this product people navigate *deliberately*: they are looking for
 * the episode about a thing, they know roughly when it aired, and what they
 * want is to go a long way back in one movement. "Load more" answers that with
 * two hundred presses. Numbers also give the one fact the old note could not —
 * how much there is — which is the difference between a list that ran out and
 * an archive you are three pages into.
 *
 * Plain links, so a page is a URL. That makes a position in the archive
 * shareable, bookmarkable and reachable with the back button, and it is what
 * lets this stay a server component with no JavaScript behind it at all.
 */
export function EpisodePager({
  page,
  pageCount,
  basePath,
  t,
}: {
  page: number;
  pageCount: number;
  /** The show's path. Page 1 is the bare path, with no query string. */
  basePath: string;
  t: Translator;
}) {
  if (pageCount <= 1) return null;

  return (
    <nav
      aria-label={t.t('podcast.pagination')}
      className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-border)] pt-6"
    >
      <p className="type-caption m-0 text-[var(--color-text-tertiary)]">
        {t.t('podcast.pageOf', { page, count: pageCount })}
      </p>

      <div className="flex items-center gap-1">
        <Step
          to={page - 1}
          disabled={page <= 1}
          label={t.t('podcast.previousPage')}
          basePath={basePath}
          direction="back"
        />

        {/*
          A window, not the whole range.

          A show with 295 pages cannot list them, and the useful shape is the
          one every archive settles on: the ends, so "the beginning" is always
          one press away, and a few either side of where you are, for stepping.
        */}
        {pagesAround(page, pageCount).map((entry, index) =>
          entry === GAP ? (
            <span
              // Positional keys are usually a smell; here the list is derived
              // purely from two numbers and has no identity beyond its slot.
              key={`gap-${index}`}
              aria-hidden="true"
              className="px-1 type-caption text-[var(--color-text-tertiary)]"
            >
              …
            </span>
          ) : (
            <PageLink
              key={entry}
              page={entry}
              current={entry === page}
              basePath={basePath}
              t={t}
            />
          ),
        )}

        <Step
          to={page + 1}
          disabled={page >= pageCount}
          label={t.t('podcast.nextPage')}
          basePath={basePath}
          direction="forward"
        />
      </div>
    </nav>
  );
}

/** Page 1 is the canonical path: two URLs for the same page is one too many. */
function hrefFor(basePath: string, page: number): Route {
  return (page <= 1 ? basePath : `${basePath}?page=${page}`) as Route;
}

function PageLink({
  page,
  current,
  basePath,
  t,
}: {
  page: number;
  current: boolean;
  basePath: string;
  t: Translator;
}) {
  return (
    <Link
      href={hrefFor(basePath, page)}
      // `page` for the one you are on, which is what a screen reader announces
      // instead of reading it as an ordinary destination.
      aria-current={current ? 'page' : undefined}
      aria-label={t.t('podcast.goToPage', { page })}
      className={[
        'flex h-9 min-w-9 items-center justify-center rounded-[var(--radius-md)] px-2',
        'type-caption tabular-nums no-underline transition-colors',
        current
          ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-text)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
      ].join(' ')}
    >
      {page}
    </Link>
  );
}

/**
 * Previous and next.
 *
 * Rendered as a `<span>` when there is nowhere to go rather than as a disabled
 * link, because there is no such thing as a disabled link — `aria-disabled` on
 * an anchor still lets it be followed by keyboard and by click. At the ends of
 * a list the control is not a broken affordance, it is not an affordance.
 */
function Step({
  to,
  disabled,
  label,
  basePath,
  direction,
}: {
  to: number;
  disabled: boolean;
  label: string;
  basePath: string;
  direction: 'back' | 'forward';
}) {
  const chevron = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Mirrored under RTL with the rest of the layout: "back" means toward the
      // start of the line, and which side that is depends on the script.
      className="rtl:-scale-x-100"
    >
      <path d={direction === 'back' ? 'M14.5 5 8 12l6.5 7' : 'M9.5 5 16 12l-6.5 7'} />
    </svg>
  );

  const shape = 'flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)]';

  if (disabled) {
    return (
      <span aria-hidden="true" className={`${shape} text-[var(--color-text-tertiary)] opacity-40`}>
        {chevron}
      </span>
    );
  }

  return (
    <Link
      href={hrefFor(basePath, to)}
      aria-label={label}
      title={label}
      className={`${shape} text-[var(--color-text-secondary)] no-underline transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]`}
    >
      {chevron}
    </Link>
  );
}

const GAP = 0;

/**
 * The page numbers worth drawing: both ends, and a window around the current
 * one, with gaps marked.
 *
 * Returns a fixed-width shape wherever possible — seven slots — so the pager
 * does not change size as you step through it. A control that reflows under the
 * cursor every time it is used makes the *next* press a fresh aiming problem.
 */
function pagesAround(page: number, pageCount: number): number[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const window = new Set<number>([1, pageCount, page]);
  for (const offset of [-1, 1]) {
    const neighbour = page + offset;
    if (neighbour > 1 && neighbour < pageCount) window.add(neighbour);
  }

  // Near an end there is no gap on that side, so the slots it would have taken
  // go to the window instead — which is what keeps the width steady.
  if (page <= 4) for (const n of [2, 3, 4, 5]) window.add(n);
  if (page >= pageCount - 3) {
    for (const n of [pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1]) window.add(n);
  }

  const sorted = [...window].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);

  const withGaps: number[] = [];
  for (const [index, value] of sorted.entries()) {
    const previous = sorted[index - 1];
    if (previous !== undefined && value - previous > 1) withGaps.push(GAP);
    withGaps.push(value);
  }

  return withGaps;
}
