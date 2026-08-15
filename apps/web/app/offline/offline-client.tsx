'use client';

import Link from 'next/link';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { useOnline } from '@/lib/connectivity';

/**
 * The offline page's content.
 *
 * A client component so it can watch connectivity: the useful moment is when
 * the connection comes back, and the page should say so rather than leaving
 * someone to guess and refresh. Retrying is still a deliberate act — reloading
 * out from under a reader the instant a signal flickers is its own annoyance.
 */
export function OfflinePage() {
  const t = useTranslator();
  const online = useOnline();

  return (
    <main className="mx-auto flex min-h-dvh max-w-[520px] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="m-0 type-title2 text-[var(--color-text-primary)]">
        {online ? t.t('common.unreachable') : t.t('offline.title')}
      </h1>

      <p className="m-0 type-body text-[var(--color-text-secondary)]">
        {online ? t.t('common.checkConnection') : t.t('offline.pageBody')}
      </p>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => window.location.reload()}>{t.t('common.retry')}</Button>

        {/* Home is the one route guaranteed to be in the cache: it is where
            everyone arrives, so it is the page most likely to have been
            visited and stored. */}
        <Link
          href={'/' as never}
          className="type-body-strong text-[var(--color-text-secondary)] underline decoration-[var(--color-border-strong)] underline-offset-4 transition-colors hover:text-[var(--color-text-primary)]"
        >
          {t.t('home.title')}
        </Link>
      </div>
    </main>
  );
}
