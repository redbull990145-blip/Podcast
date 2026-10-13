'use client';

import { useTranslator } from '@/components/i18n/locale-provider';
import { applyTheme, isLightNow, readDarkVariant, useThemeChoice } from '@/lib/theme';

/**
 * Light or dark, in one press.
 *
 * The full set of schemes lives in Settings — there are three now, plus
 * "follow the system", and a control with four positions is not something to
 * put at the top of Home. This is the shortcut: the one axis people flip
 * often, on the screen they are already on.
 *
 * "Dark" here means *their* dark. There are two dark schemes, and this reaches
 * for whichever one they last chose rather than always the warm default —
 * otherwise picking Onyx in Settings and pressing this twice would quietly put
 * them back on the theme they had just rejected.
 *
 * The label says what pressing it *does*, not what it currently is. A button
 * announced as "Dark theme" is ambiguous about whether that is the state or the
 * destination, and a screen-reader user has no icon to disambiguate it with.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const t = useTranslator();

  /*
    Subscribed rather than read once.

    The picker in Settings writes the same state, and on a system-following
    install the OS itself can change it at sunset — the icon is a claim about
    what is on screen, so it has to follow both. Before hydration this reports
    `system`, which is what the server rendered.
  */
  const choice = useThemeChoice();
  const light = isLightNow(choice);

  return (
    <button
      type="button"
      onClick={() => applyTheme(light ? readDarkVariant() : 'light')}
      aria-label={light ? t.t('theme.toDark') : t.t('theme.toLight')}
      title={light ? t.t('theme.toDark') : t.t('theme.toLight')}
      className={[
        'flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full',
        'border-0 bg-[var(--color-surface-hover)] p-0 text-[var(--color-text-primary)]',
        'cue-button hover:bg-[var(--color-surface-pressed)]',
        className,
      ].join(' ')}
    >
      <span key={light ? 'moon' : 'sun'} className="cue-theme-icon flex">
        {light ? <MoonIcon /> : <SunIcon />}
      </span>
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
