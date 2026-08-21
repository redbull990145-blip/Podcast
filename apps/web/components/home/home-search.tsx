'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';

/**
 * Search, on the front page.
 *
 * The product's own framing is that search is the front door rather than a
 * secondary tab — and until now Home offered no way through it. A visitor who
 * arrived wanting a specific show had to notice the sidebar, which on a phone
 * is a tab bar icon competing with three others.
 *
 * It does not search here. Home is not the results screen, and building a
 * second one inside it would mean two copies of the query, language filter and
 * add-to-catalogue flow drifting apart. This is a doorway: it collects the
 * query and hands it to `/search`, which already does all of that well.
 *
 * A real `<form action="/search">` underneath, so it works before hydration
 * and without JavaScript at all — the submit is a plain GET to the same URL
 * the router pushes. The handler exists only to make the navigation a client
 * transition instead of a document load.
 */
export function HomeSearch() {
  const t = useTranslator();
  const router = useRouter();
  const [value, setValue] = useState('');

  const query = value.trim();

  return (
    <form
      action="/search"
      method="get"
      role="search"
      onSubmit={(event) => {
        if (!query) {
          // Nothing to search for. Swallowing the submit keeps Enter on an
          // empty field from navigating to a bare results screen.
          event.preventDefault();
          return;
        }
        event.preventDefault();
        router.push(`/search?q=${encodeURIComponent(query)}` as Route);
      }}
      className="relative flex w-full items-center"
    >
      <label htmlFor="home-search" className="sr-only">
        {t.t('search.title')}
      </label>

      <svg
        aria-hidden="true"
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        // `start-4` rather than `left-4`: the whole app mirrors under Arabic,
        // and an icon pinned to the left would sit on top of the text there.
        className="pointer-events-none absolute start-3.5 text-[var(--color-text-tertiary)]"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>

      <input
        id="home-search"
        name="q"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t.t('home.searchCta')}
        autoComplete="off"
        // Labels the phone keyboard's action key "Search" rather than "Go",
        // which is the difference between the field looking like a destination
        // and looking like an address bar.
        enterKeyHint="search"
        className={[
          // A pill rather than a rounded rectangle. Every control in this design
          // that *does something* is a pill; the boxes are the things that hold
          // content. A search field is a control.
          'min-h-11 w-full rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] ps-10 type-body-strong text-[var(--color-text-primary)] outline-none transition-colors',
          'placeholder:text-[var(--color-text-tertiary)] hover:border-[var(--color-border-strong)] focus-visible:border-[var(--color-accent)]',
          // `type="search"` is kept for the phone keyboard's Search key, but
          // its native clear button comes with it — an unstyleable blue cross
          // that lands directly beside the submit button and belongs to no
          // palette we control. Two adjacent controls, one of them off-theme,
          // for a field whose entire job is one query and a navigation.
          '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
          // Room for the submit button only while there is a submit button.
          // Reserving it permanently truncated the placeholder on a phone —
          // "Search shows, topics, p" — to keep clear of a control that was
          // not on screen. Nothing visibly reflows when it changes: the text
          // is start-aligned, so only the far edge of the box moves, and it
          // moves at the keystroke that makes the placeholder disappear.
          query ? 'pe-22' : 'pe-4',
        ].join(' ')}
      />

      {/*
        Present only once there is something to submit.

        An always-visible button on an empty field is a control that does
        nothing, and on this page it would be the loudest thing above the fold —
        competing with the play buttons, which are the actions that matter. It
        appears the moment it becomes real.

        Enter already submits, so this is not the only route in: it is the
        visible affordance for anyone who does not assume it.
      */}
      {query ? (
        <button
          type="submit"
          className="absolute end-1.5 flex min-h-8 cursor-pointer items-center rounded-full border-0 bg-[var(--color-ink)] px-3.5 type-caption text-[var(--color-text-on-ink)] transition-[transform,opacity] duration-[var(--duration-instant)] ease-standard hover:opacity-90 active:scale-[0.97] motion-reduce:active:scale-100"
        >
          {t.t('search.title')}
        </button>
      ) : null}
    </form>
  );
}
