'use client';

import { icon } from '@cue/design';
import { duration } from '@cue/motion';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { useCanTravel, usePressScale, useTransition } from '@/lib/motion';

/**
 * A row that holds more than it shows.
 *
 * The shape every streaming service uses for a shelf, and for a reason worth
 * stating: a recommendation rail has two jobs that pull against each other. It
 * has to be short, because a wall of equally-weighted covers is a listing and a
 * listing cannot recommend anything — and it has to carry enough that pressing
 * "more" is not immediately a dead end. Paging is how both hold: three at a
 * time on screen, six in the shelf.
 *
 * **Server children, client paging.** The items arrive as already-rendered
 * nodes, so a server component can hand its own output straight in and keep the
 * data fetching on the server. This component only decides which three are
 * visible.
 *
 * The whole page moves as one, rather than each cover animating in on its own
 * delay. A stagger reads as content arriving; this is the same shelf turned to
 * a different position, and turning is one movement.
 */
/**
 * The width of one column, as CSS.
 *
 * `gap-x-5` is 1.25rem, and the grid divides the row into `perPage` equal
 * tracks with `perPage - 1` gaps between them. Duplicated from the class below
 * rather than left implicit for the same reason the player duplicates its
 * sheet padding: two things have to agree to the pixel, and the one that is
 * positioned absolutely cannot ask the one that is laid out.
 */
const COVER_BOX = (perPage: number) =>
  `calc((100% - ${perPage - 1} * 1.25rem) / ${perPage})`;

export function PagedRail({
  items,
  /**
   * How many items a turn of the shelf advances by.
   *
   * Not the column count — see the grid below. On a desktop the two are the
   * same and that is why they were once one number; on a phone the same three
   * items are stacked rather than squeezed.
   */
  perPage = 3,
  /** The section's heading, and the `id` its `aria-labelledby` points at. */
  label,
  headingId,
  note,
  action,
  className = '',
}: {
  items: ReactNode[];
  perPage?: number;
  label: string;
  headingId: string;
  note?: string;
  /**
   * The way out of the rail entirely, as a chevron beside the heading.
   *
   * A different control from the arrows on the covers, and both belong. The
   * edge arrows turn this shelf — six items, three at a time, never leaving
   * Home. This one goes to the page that has *everything*, which is a
   * destination rather than a position. Collapsing them into one control means
   * either the shelf cannot be turned or the full list cannot be reached.
   */
  action?: { href: string; label: string };
  className?: string;
}) {
  const t = useTranslator();
  const travel = useCanTravel();
  const settle = useTransition('standard');
  const press = usePressScale(0.94);

  const pages = Math.ceil(items.length / perPage);
  /** `page` and the direction it last moved, so the slide knows which way. */
  const [{ page, delta }, setPage] = useState({ page: 0, delta: 1 });

  const go = (step: number) =>
    // Wraps rather than stopping. With two pages a control that disables
    // itself at the end is a button that works once and then looks broken;
    // wrapping makes it a toggle between halves of the same shelf.
    setPage(({ page: current }) => ({
      page: (current + step + pages) % pages,
      delta: step,
    }));

  const visible = items.slice(page * perPage, page * perPage + perPage);

  return (
    <div className={className}>
      {/*
        The header is rendered here rather than by the caller, because the
        control that advances the shelf has to sit beside the heading and share
        the shelf's state. Passing a chevron down from the caller would mean
        lifting `page` out of the one component that uses it.
      */}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <h2 id={headingId} className="type-title2 m-0 text-[var(--color-text-primary)]">
            {label}
          </h2>
          {note ? (
            <p className="type-callout mt-1 mb-0 text-[var(--color-text-tertiary)]">{note}</p>
          ) : null}
        </div>

        {action ? (
          <Link
            href={action.href as Route}
            aria-label={action.label}
            title={action.label}
            className={[
              'flex h-9 w-9 shrink-0 self-center items-center justify-center rounded-full no-underline',
              'border border-[var(--color-border)] text-[var(--color-text-secondary)]',
              'transition-[transform,background-color,color] duration-[var(--duration-fast)] ease-standard',
              'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
              'active:scale-[0.94] motion-reduce:active:scale-100',
            ].join(' ')}
          >
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
        ) : null}
      </div>

      {/*
        A bleed, contained.

        The arrows below are pushed clear of the outer covers, into the empty
        margin beside the row — which on this width of window is real,
        unclaimed space, and on a narrower one is fourteen or fifteen pixels
        that do not exist. Without this wrapper the button simply ran past the
        page's own right edge there, and the *page* grew a horizontal
        scrollbar to show it — an arrow four sections down the screen, on a
        window nobody had resized on purpose.

        The negative margin and matching padding is the same bleed trick as
        the sliding clip below, one size class up: it reserves exactly `GUTTER`
        of room on each side for the arrow to sit in, while `overflow-hidden`
        on *this* box means that reservation is where the story ends — nothing
        pushed into it can be seen past this element's own edge, so the page
        never learns the button was ever wider than its column. Because the
        padding and the margin are equal and opposite, the *content* inside —
        the heading-aligned row of covers — is exactly as wide as it was before
        this existed.

        `14` (56px) is not a free choice: it is `EdgeArrow`'s own button width
        plus its gap, hard-coded there as `calc(100% + 12px)`. The two numbers
        have to move together, because this is the size of the room being
        reserved and that is the distance being pushed into it — written as a
        literal in both places rather than as a shared token because Tailwind
        resolves classes statically and cannot take a variable here.
      */}
      <div className="-mx-14 overflow-hidden px-14">
      <div className="relative">
        {/*
          The arrows sit clear of the row entirely, in the margin beside it.

          Two things had to be fixed to get here. Centring each arrow *inside*
          a box the width of one column — `place-items-center` on a box that
          wide — put the button near the middle of the outer cover instead of
          at the edge of the row, which read as damage to that show's artwork
          rather than a control for the shelf. `justify-end`/`justify-start`
          pins it to the box's own outer edge instead — the row's outer edge,
          because the box is anchored there.

          That still left the button half-overlapping the cover at the seam,
          which was closer but not clear of the artwork. `EdgeArrow`'s own
          translate pushes it a further full width past that edge, into open
          margin, so nothing sits on top of anyone's cover at all.

          Vertical centring still comes from `COVER_BOX`: the middle of a cell
          is well below the middle of its cover once the caption is included,
          so the arrow needs the artwork's own height, not the cell's.
        */}
        {/*
          Only where their geometry is true.

          Both anchors are boxes one column wide and square, which is how the
          arrow finds the vertical middle of a *cover* rather than of a cell
          that also contains a caption. That arithmetic holds while the row is
          `perPage` columns across and stops holding the moment it is not — at
          one column the box is the full width of the page and the arrow would
          sit a third of the way down it. Below `lg` the dots turn the shelf
          instead, which they already did and which is the more reachable
          control on a touch screen anyway.
        */}
        <div
          className="pointer-events-none absolute top-0 end-0 z-10 hidden items-center justify-end lg:flex"
          style={{ width: COVER_BOX(perPage), aspectRatio: '1 / 1' }}
        >
          {pages > 1 ? <EdgeArrow direction="next" onClick={() => go(1)} label={t.t('rail.next', { section: label })} /> : null}
        </div>

        {/* Only once there is something behind you. On the first page a
            back-arrow points at nothing, and a control that does nothing is
            worse than one that is not there. */}
        <div
          className="pointer-events-none absolute top-0 start-0 z-10 hidden items-center justify-start lg:flex"
          style={{ width: COVER_BOX(perPage), aspectRatio: '1 / 1' }}
        >
          {pages > 1 && page > 0 ? (
            <EdgeArrow direction="prev" onClick={() => go(-1)} label={t.t('rail.previous', { section: label })} />
          ) : null}
        </div>

        <div className="-mx-2 overflow-hidden px-2">
        <AnimatePresence mode="wait" initial={false}>
          <m.ul
            key={page}
            initial={travel ? { opacity: 0, x: delta * 40 } : { opacity: 0 }}
            animate={{ opacity: 1, x: 0 }}
            exit={travel ? { opacity: 0, x: delta * -40 } : { opacity: 0 }}
            // Sprung on the travel, tweened on the fade — springs move things,
            // tweens fade them, and a sprung opacity overshoots past 1 and
            // flickers where the compositor clamps it.
            transition={{ ...settle, opacity: { duration: duration.fast / 1000 } }}
            /*
              Columns follow the width; the *page* does not.

              `perPage` is how many items a turn of the shelf advances by, and
              that stays 3 at every size — it is an editorial decision about how
              much to offer, not a layout one. How many of those three sit side
              by side is a layout question, and it was answered with an inline
              `repeat(3, …)`, which no media query can reach: at 375px both of
              Home's rails rendered three 98px columns, which is not a readable
              width for a cover with a title under it.

              Two across below `lg`, not one. That is the ladder every other
              cover grid in this app already uses — `ForYou` on Search, a
              category's results — and it is the denser of the two readable
              answers: one column makes a 375px phone show a single 335px cover
              at a time, which is a poster rather than a shelf. The last row of
              a three-item page is ragged at two columns, and that is the price
              of the density.
            */
            className="m-0 grid list-none grid-cols-2 gap-x-5 gap-y-7 p-0 lg:grid-cols-3"
          >
            {visible}
          </m.ul>
        </AnimatePresence>
        </div>
      </div>
      </div>

      {/* Dots, only once there is more than one page. They are the part that
          says the shelf continues — an arrow alone says a direction exists but
          not how far it goes. */}
      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-2">
          {Array.from({ length: pages }, (_, index) => (
            <m.button
              key={index}
              type="button"
              onClick={() => setPage({ page: index, delta: index > page ? 1 : -1 })}
              aria-label={t.t('rail.goToPage', { page: index + 1, total: pages })}
              aria-current={index === page}
              whileTap={{ scale: press }}
              transition={settle}
              className="flex h-6 w-6 cursor-pointer items-center justify-center border-0 bg-transparent p-0"
            >
              <m.span
                aria-hidden="true"
                // Width rather than colour alone: the current page has to be
                // distinguishable without relying on a contrast difference
                // between two greys.
                animate={{ width: index === page ? 18 : 6 }}
                transition={settle}
                className={[
                  'block h-1.5 rounded-full',
                  index === page
                    ? 'bg-[var(--color-text-primary)]'
                    : 'bg-[var(--color-border-strong)]',
                ].join(' ')}
              />
            </m.button>
          ))}
        </div>
      ) : null}
    </div>
  );
}


/**
 * The circular arrow that hangs over the edge of the covers.
 *
 * A solid disc rather than the outlined chevron the section headings use, and
 * deliberately so: this one sits *on* artwork rather than on the page ground,
 * so it needs its own opaque surface to stay legible against whatever cover
 * happens to be underneath it. The backdrop blur is what keeps it from reading
 * as a sticker.
 *
 * `pointer-events-auto` because its container turns them off — the container
 * spans a whole cover and would otherwise swallow clicks on the show beneath.
 */
function EdgeArrow({
  direction,
  onClick,
  label,
}: {
  direction: 'next' | 'prev';
  onClick: () => void;
  label: string;
}) {
  const press = usePressScale(0.9);
  const settle = useTransition('responsive');

  return (
    <m.button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      whileTap={{ scale: press }}
      whileHover={{ scale: 1.08 }}
      transition={settle}
      className={[
        'pointer-events-auto flex h-11 w-11 cursor-pointer items-center justify-center rounded-full',
        'border border-[var(--color-border)] bg-[var(--color-surface-overlay)]/85 backdrop-blur-md',
        'text-[var(--color-text-primary)] [box-shadow:var(--elevation-md)]',
        'transition-colors hover:bg-[var(--color-surface-overlay)]',
        /*
          Clear of the row entirely, sitting in the margin beside it.

          A half-hung disc — straddling the seam between the last cover and the
          page — was the first attempt at "belongs to the row, not the show,"
          and it still put half a circle on top of someone's artwork. The
          honest version doesn't touch the cover at all: translated a full
          button-width plus a gap past the edge the container already pinned it
          to, so the whole control sits in open space and the artwork stays
          intact under it.
        */
        direction === 'next'
          ? 'translate-x-[calc(100%+12px)] rtl:translate-x-[calc(-100%-12px)]'
          : 'translate-x-[calc(-100%-12px)] rtl:translate-x-[calc(100%+12px)]',
      ].join(' ')}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={direction === 'prev' ? 'rotate-180 rtl:rotate-0' : 'rtl:rotate-180'}
      >
        <path d={icon.chevronRight} />
      </svg>
    </m.button>
  );
}
