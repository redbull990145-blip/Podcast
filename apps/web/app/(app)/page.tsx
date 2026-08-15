import type { Podcast } from '@cue/types';
import { ContinueListening } from '@/components/home/continue-listening';
import { PodcastTile } from '@/components/podcast/podcast-tile';
import { api, ApiClientError } from '@/lib/api';

/**
 * Home.
 *
 * Rendered on the server so the first paint carries real content rather than
 * a skeleton that resolves a moment later — the fastest loading state is the
 * one that never appears.
 *
 * Revalidated rather than rendered per request: podcast metadata changes when
 * a publisher edits it, which is rarely, so serving a cached page and
 * refreshing it in the background is both faster and cheaper than querying on
 * every visit.
 */
export const revalidate = 300;

export default async function HomePage() {
  let podcasts: Podcast[] = [];
  let failure: string | null = null;

  try {
    const page = await api.getPodcasts({ limit: 18 });
    podcasts = page.items;
  } catch (error) {
    // The API being down is a state to render, not a crash. A blank screen
    // with no explanation is the worst possible version of this.
    failure =
      error instanceof ApiClientError
        ? error.message
        : 'Could not load podcasts right now.';
  }

  return (
    <div className="mx-auto w-full max-w-[var(--measure-content)] px-5 py-8 md:px-10 md:py-12">
      <header className="mb-10">
        <h1 className="type-display m-0 text-[var(--color-text-primary)]">Listen</h1>
      </header>

      {/*
        Above the catalogue, and client-rendered while the page around it is
        static. What is in progress is per-listener and changes by the minute,
        so it cannot share the page's 5-minute cache — and it must not stop the
        rest of Home from being served instantly to everyone.
      */}
      <ContinueListening />

      {failure ? <ErrorState message={failure} /> : null}

      {!failure && podcasts.length === 0 ? <EmptyState /> : null}

      {podcasts.length > 0 ? (
        <section aria-labelledby="catalogue-heading">
          {/*
            Not "in your catalogue", which it never was.

            `GET /podcasts` returns every show anyone has added — it is one
            shared catalogue, not a per-listener one. Calling it *yours* meant
            that opening a search result, which has to read the feed to have
            anything to show you, made a show appear under a heading claiming
            you had collected it. That is why adding felt automatic: the label
            was describing something that had not happened. Your shows live in
            Library, behind Follow, and always did.
          */}
          <h2
            id="catalogue-heading"
            className="type-overline mb-4 text-[var(--color-text-tertiary)]"
          >
            EVERYTHING ON CUE
          </h2>

          <ul className="grid list-none grid-cols-2 gap-x-5 gap-y-8 p-0 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {podcasts.map((podcast, index) => (
              <li key={podcast.id}>
                {/* The first row is above the fold on every breakpoint, so it
                    loads eagerly; the rest stay lazy. */}
                <PodcastTile podcast={podcast} priority={index < 5} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-6 py-12 text-center">
      <h2 className="type-title3 m-0 text-[var(--color-text-primary)]">Nothing here yet</h2>
      <p className="type-callout mx-auto mt-2 mb-0 max-w-[42ch] text-[var(--color-text-secondary)]">
        Add a show by its RSS feed, or seed the local database with{' '}
        <code className="rounded-[var(--radius-xs)] bg-[var(--color-surface-raised)] px-1.5 py-0.5">
          npm run seed -w @cue/api
        </code>
        .
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-6 py-12 text-center">
      <h2 className="type-title3 m-0 text-[var(--color-text-primary)]">
        Couldn&rsquo;t reach the server
      </h2>
      <p className="type-callout mx-auto mt-2 mb-0 max-w-[42ch] text-[var(--color-text-secondary)]">
        {message} Check that the API is running on{' '}
        <code className="rounded-[var(--radius-xs)] bg-[var(--color-surface-raised)] px-1.5 py-0.5">
          npm run dev -w @cue/api
        </code>
        .
      </p>
    </div>
  );
}
