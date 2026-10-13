import type { Metadata } from 'next';
import { SearchClient } from './search-client';
import { getTranslator } from '@/lib/i18n';
import { PageShell } from '@/components/ui/page-shell';

export const metadata: Metadata = { title: 'Search' };

/**
 * Search.
 *
 * Seeded from `?q=`, which is what makes Home's search field a doorway rather
 * than a second search implementation: it collects a query and hands it here.
 * Read on the server rather than through `useSearchParams`, so the results are
 * already being fetched on the first client render instead of one effect
 * later — and so a shared or bookmarked search URL opens on its own results.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; category?: string | string[] }>;
}) {
  const [{ q, category }, t] = await Promise.all([searchParams, getTranslator()]);

  // A repeated `?q=` gives an array. Taking the first is the only sane reading
  // and beats rendering "a,b" into the field.
  const initialQuery = (Array.isArray(q) ? q[0] : q) ?? '';
  const slug = (Array.isArray(category) ? category[0] : category) ?? null;

  return (
    <PageShell width="wide">
      {/* The title goes when a category is open — that screen has a heading of
          its own, and stacking "Search" above "Technology" is one page title
          too many for a page with one subject. */}
      {slug ? null : (
        <h1 className="type-display mt-0 mb-6 text-[var(--color-text-primary)]">
          {t.t('search.title')}
        </h1>
      )}
      <SearchClient initialQuery={initialQuery} category={slug} />
    </PageShell>
  );
}
