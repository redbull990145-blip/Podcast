import type { ReactNode } from 'react';

/**
 * A section with nothing in it, saying why and what to do about it.
 *
 * This was six components and one inline copy, five of which were the *same*
 * component: `rounded-lg border border-dashed px-6 py-12 text-center` with a
 * `type-title3` heading and a `type-callout` body, written out in the queue, in
 * the playlist grid, in the playlist detail, in the Library's tabs and in the
 * playlists client. Six copies of a panel is six places for a padding to drift,
 * and one of them had already lost its translations along the way.
 *
 * The tones are three genuinely different jobs rather than three skins:
 *
 *  - **`outlined`** — the dashed panel. For a *container* that is empty: a
 *    queue, a playlist, a grid. The dashes say "things go here", which is why
 *    it is centred and why it has an edge at all.
 *  - **`plain`** — no chrome. For a *page region* that has nothing to show, on
 *    a screen that has other content: the Library's groups, Search's advice.
 *    A panel there would draw a box around an absence.
 *  - **`panel`** — a filled surface. For a failure the page has to report
 *    while the rest of it still works, which on Home is the catalogue being
 *    unreachable.
 *
 * **Only `outlined` is centred**, and the split is not about how much chrome
 * each has. A dashed container is a *slot* — it says "things go here", it has
 * no content to align to, and centring is what makes it read as waiting rather
 * than as failed. The other two sit in the reading column of a page that is
 * already left-aligned, and Home's note about its own panel is the reason this
 * is written down: centred text under a left-aligned masthead reads as a
 * fragment pasted in, and it puts the one control the reader needs in the
 * middle of the screen, away from the edge they are already reading down.
 */
export function EmptyState({
  title,
  body,
  detail,
  tone = 'outlined',
  action,
  children,
}: {
  title: string;
  body?: string;
  /**
   * A second, quieter line — the server's own words, or a caveat.
   *
   * Its own element rather than appended to `body`, because a message written
   * by the API has no punctuation contract with a sentence written here:
   * concatenating them produced "Could not reach the server The catalogue
   * didn't load."
   */
  detail?: string;
  tone?: 'outlined' | 'plain' | 'panel';
  /** The way out. Rendered by the caller so it can be a link, a button, or both. */
  action?: ReactNode;
  /** Anything after the action — a development hint, a caveat. */
  children?: ReactNode;
}) {
  const centred = tone === 'outlined';

  return (
    <div
      className={[
        tone === 'outlined'
          ? 'rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-6 py-12'
          : tone === 'panel'
            ? 'rounded-[var(--radius-lg)] bg-[var(--color-surface)] px-6 py-10'
            : 'py-10',
        centred ? 'text-center' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <p className="type-title3 m-0 text-[var(--color-text-primary)]">{title}</p>

      {body ? (
        <p
          className={[
            'type-callout mt-2 mb-0 max-w-[var(--measure-prose)] text-[var(--color-text-secondary)]',
            centred ? 'mx-auto' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {body}
        </p>
      ) : null}

      {detail ? (
        <p
          className={[
            'type-caption mt-2 mb-0 max-w-[52ch] text-[var(--color-text-tertiary)]',
            centred ? 'mx-auto' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {detail}
        </p>
      ) : null}

      {action ? (
        <div
          className={[
            'mt-5 flex flex-wrap items-center gap-3',
            centred ? 'justify-center' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {action}
        </div>
      ) : null}

      {children}
    </div>
  );
}
