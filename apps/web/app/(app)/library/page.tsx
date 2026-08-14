import type { Metadata } from 'next';
import { LibraryClient } from './library-client';

export const metadata: Metadata = { title: 'Library' };

export default function LibraryPage() {
  return (
    <div className="mx-auto w-full max-w-[var(--measure-content)] px-5 py-8 md:px-10 md:py-12">
      <h1 className="type-display mt-0 mb-8 text-[var(--color-text-primary)]">Library</h1>
      <LibraryClient />
    </div>
  );
}
