import type { Metadata } from 'next';
import { SearchClient } from './search-client';

export const metadata: Metadata = { title: 'Search' };

export default function SearchPage() {
  return (
    <div className="mx-auto w-full max-w-[var(--measure-content)] px-5 py-8 md:px-10 md:py-12">
      <h1 className="type-title1 mt-0 mb-6 text-[var(--color-text-primary)]">Search</h1>
      <SearchClient />
    </div>
  );
}
