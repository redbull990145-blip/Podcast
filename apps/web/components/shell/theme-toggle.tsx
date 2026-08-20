'use client';

import { useEffect, useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';

/**
 * The key the inline script in `app/layout.tsx` reads before first paint.
 * Written out in two places on purpose — the script cannot import anything, so
 * this is the constant and that is its copy, kept side by side in a comment
 * there rather than left to be discovered.
 */
const STORAGE_KEY = 'cue-theme';

type Choice = 'dark' | 'light';

/**
 * Dark and light, with dark as the default.
 *
 * The app is dark-first because listening happens in the dark and in transit,
 * and artwork sits better on a dark ground — that has not changed. What changed
 * is the assumption underneath it: that "most people, most of the time" is the
 * same as "everyone, always". The light theme was already built, already tested
 * for contrast, and already reachable by anyone whose *system* was set to light
 * — so the only people it was withheld from were those who wanted a light app
 * on a dark machine, which is a preference the product had no reason to have an
 * opinion about.
 *
 * Three states, not two, and the third is the one that matters: no stored
 * choice means *follow the system*, which is what a fresh install does and what
 * the media query in `tokens.css` handles on its own. Pressing the control
 * leaves that state permanently — there is no way back to "follow the system"
 * from here, and there should not be a third position on a control most people
 * will press once.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const t = useTranslator();
  const [choice, setChoice] = useState<Choice | null>(null);

  /*
    Read after mount, never during render.

    The server has no idea what is in localStorage, so a component that read it
    while rendering would produce different markup on the two sides and React
    would throw the whole tree away. The button's *appearance* is therefore
    driven by what the document already says — which the inline script set
    before paint — rather than by state that arrives a frame late.
  */
  useEffect(() => {
    const stored = document.documentElement.dataset['theme'];
    setChoice(stored === 'light' || stored === 'dark' ? stored : null);
  }, []);

  const isLight =
    choice === 'light' ||
    (choice === null &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: light)').matches);

  function toggle() {
    const next: Choice = isLight ? 'dark' : 'light';
    document.documentElement.dataset['theme'] = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing, or a storage quota that is full. The theme still
      // changes for this session; only the memory of it is lost, which is not
      // worth failing a button press over.
    }
    setChoice(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // The label says what pressing it *does*, not what it currently is. A
      // button announced as "Dark theme" is ambiguous about whether that is the
      // state or the destination, and a screen-reader user has no icon to
      // disambiguate it with.
      aria-label={isLight ? t.t('theme.toDark') : t.t('theme.toLight')}
      title={isLight ? t.t('theme.toDark') : t.t('theme.toLight')}
      className={[
        'flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full',
        'border-0 bg-[var(--color-surface-hover)] p-0 text-[var(--color-text-primary)]',
        'transition-colors hover:bg-[var(--color-surface-pressed)]',
        className,
      ].join(' ')}
    >
      {/* Rendered from state rather than crossfaded: the icon is the answer to
          "which way does this go", and two of them dissolving through each
          other is a moment where it answers neither. */}
      {isLight ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="10" y1="1.5" x2="10" y2="3.5" />
        <line x1="10" y1="16.5" x2="10" y2="18.5" />
        <line x1="1.5" y1="10" x2="3.5" y2="10" />
        <line x1="16.5" y1="10" x2="18.5" y2="10" />
        <line x1="3.8" y1="3.8" x2="5.3" y2="5.3" />
        <line x1="14.7" y1="14.7" x2="16.2" y2="16.2" />
        <line x1="3.8" y1="16.2" x2="5.3" y2="14.7" />
        <line x1="14.7" y1="5.3" x2="16.2" y2="3.8" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M16 12.5A7.5 7.5 0 1 1 7.5 4 5.5 5.5 0 0 0 16 12.5Z" fill="currentColor" />
    </svg>
  );
}
