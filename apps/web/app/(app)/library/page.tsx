import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LibraryTabs } from './library-tabs';

export const metadata: Metadata = { title: 'Library' };

export default function LibraryPage() {
  return (
    <div className="mx-auto w-full max-w-[var(--measure-content)] px-5 py-8 md:px-10 md:py-12">
      <h1 className="type-display mt-0 mb-8 text-[var(--color-text-primary)]">Library</h1>

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
    </div>
  );
}
