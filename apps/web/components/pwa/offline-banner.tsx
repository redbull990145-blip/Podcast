'use client';

import { icon } from '@cue/design';
import { useTranslator } from '@/components/i18n/locale-provider';
import { NavIcon } from '@/components/shell/nav-icon';
import { useOnline } from '@/lib/connectivity';

/**
 * A strip that says the connection is gone.
 *
 * Deliberately not an error, and deliberately not a modal. Losing a connection
 * is ordinary, the app keeps working from cache when it happens, and the only
 * thing the reader needs is an explanation for why nothing new is arriving.
 *
 * Pinned to the top rather than laid into the flow: it appears without being
 * asked for, and content that shoves the page down mid-read is worse than the
 * problem it is reporting. It fades in, because opacity is the one transition
 * that stays honest under `prefers-reduced-motion` — the same movement for
 * everybody rather than a second path to get wrong.
 */
export function OfflineBanner() {
  const online = useOnline();
  const t = useTranslator();

  return (
    <div
      role="status"
      aria-live="polite"
      // Rendered either way and faded, so it can leave as gently as it arrived
      // — and `hidden` when online, so a screen reader never meets an empty
      // status region or a pointer catches an invisible bar.
      aria-hidden={online || undefined}
      className={[
        'fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2',
        'border-b border-[var(--color-border)] bg-[var(--color-surface-overlay)]',
        'px-4 py-2 type-caption text-[var(--color-text-secondary)]',
        'transition-opacity duration-[var(--duration-base)] ease-standard',
        online ? 'pointer-events-none opacity-0' : 'opacity-100',
      ].join(' ')}
    >
      <span className="shrink-0" aria-hidden="true">
        <NavIcon path={icon.offline} filled={false} />
      </span>
      {/* The web has no downloads — saved audio is an Android feature — so
          this says what is actually true here: you are seeing the cache. */}
      {t.t('offline.bannerWeb')}
    </div>
  );
}
