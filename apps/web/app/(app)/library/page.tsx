import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslator } from '@/lib/i18n';
import { LibraryTabs } from './library-tabs';
import { PageShell } from '@/components/ui/page-shell';

export const metadata: Metadata = { title: 'Library' };

export default async function LibraryPage() {
  const t = await getTranslator();

  return (
    <PageShell>
      <h1 className="type-display mt-0 mb-8 text-[var(--color-text-primary)]">
        {t.t('library.title')}
      </h1>

      {/*
        `useSearchParams` opts its whole subtree into client rendering, and Next
        requires the boundary to be explicit — without it the build fails rather
        than silently making the page dynamic. The fallback is nothing on
        purpose: the tabs resolve in the same tick, and a skeleton that flashes
        for one frame is worse than a frame of stillness.
      */}
      <Suspense fallback={null}>
        <LibraryTabs />
      </Suspense>
    </PageShell>
  );
}
