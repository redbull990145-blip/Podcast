import { icon } from '@cue/design';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

type SectionHeaderProps = {
  /** The section's name. Rendered as the heading. */
  label: string;
  /** The `id` the section's `aria-labelledby` points at. */
  id: string;
  /**
   * What the ordering means, in a sentence.
   *
   * Optional, and worth having whenever the order is a decision rather than an
   * obvious consequence. "Everything on Cue" over a grid says nothing about why
   * one show is first; "Most recently published first" turns the same grid into
   * something a reader can navigate deliberately.
   */
  note?: string;
  /**
   * A link out of the section, e.g. to the full list.
   *
   * `variant: 'icon'` draws it as a round chevron button on the section's end
   * edge instead of a word. Worth it on the artwork rails, where the covers
   * below already carry a lot of weight and a second text link competing with
   * the heading is one thing too many in the corner — the affordance people
   * actually look for at the end of a row is an arrow.
   */
  action?: { href: string; label: string; variant?: 'text' | 'icon' };
  /** Heading level. Sections nested under another heading need `h3`. */
  as?: 'h2' | 'h3';
  children?: ReactNode;
};

/**
 * What starts a section.
 *
 * This used to be a small uppercase label with a hairline running off to the
 * right of it, on the reasoning that a rule gives each section a visible top
 * edge. It did — and it also gave every section on the page the same weight as
 * every other, because an 11px label carries none of its own. Home ended up
 * reading as five equally important strips whichever one actually mattered.
 *
 * A 20px heading with the note *underneath* it does the same structural job by
 * being legible from a scroll: the eye lands on words rather than on a line,
 * and the difference between a section heading and a page title is now a real
 * two-step rather than the difference between small-caps and large.
 *
 * The note moved below the label rather than beside it for the same reason it
 * exists at all — it is a sentence about the section, and a sentence set on the
 * same baseline as a heading, separated from it by a rule, reads as a caption
 * for something else.
 */
export function SectionHeader({
  label,
  id,
  note,
  action,
  as: Heading = 'h2',
  children,
}: SectionHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <div className="min-w-0">
        <Heading id={id} className="type-title2 m-0 text-[var(--color-text-primary)]">
          {label}
        </Heading>

        {note ? (
          <p className="type-callout mt-1 mb-0 text-[var(--color-text-tertiary)]">
            {note}
          </p>
        ) : null}
      </div>

      {action?.variant === 'icon' ? (
        <Link
          href={action.href as Route}
          // The label is the accessible name rather than visible text — a
          // bare chevron is meaningless to a screen reader, and "View more"
          // on its own is meaningless to anyone with several sections open.
          aria-label={action.label}
          title={action.label}
          className={[
            // `self-center`: the row aligns on the baseline for the heading and
            // its note, and a 36px circle has no baseline worth aligning to.
            'flex h-9 w-9 shrink-0 self-center items-center justify-center rounded-full no-underline',
            'border border-[var(--color-border)] text-[var(--color-text-secondary)]',
            'transition-[transform,background-color,color] duration-[var(--duration-fast)] ease-standard',
            'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
            'active:scale-[0.94] motion-reduce:active:scale-100',
          ].join(' ')}
        >
          {/* Mirrored under Arabic, where "onward" is the other way. */}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="rtl:-scale-x-100"
          >
            <path d={icon.chevronRight} />
          </svg>
        </Link>
      ) : action ? (
        <Link
          href={action.href as Route}
          className="type-callout shrink-0 text-[var(--color-text-tertiary)] no-underline underline-offset-4 transition-colors hover:text-[var(--color-text-primary)] hover:underline"
        >
          {action.label}
        </Link>
      ) : null}

      {children}
    </div>
  );
}
