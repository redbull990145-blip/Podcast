'use client';

import { ApiClientError } from '@cue/api-client';
import type { SupportedLocale } from '@cue/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { domAnimation, LazyMotion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { LocaleProvider } from '@/components/i18n/locale-provider';

/**
 * Server state.
 *
 * The defaults here are most of what makes the app feel fast: cached data is
 * shown immediately and revalidated behind the scenes, so navigating back to a
 * screen you've already seen is instant rather than a spinner.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Per-query `staleTime` from @cue/api-client overrides this; the
        // default is simply "don't refetch the instant a component remounts".
        staleTime: 60_000,
        gcTime: 30 * 60_000,

        // The window regaining focus is not evidence that podcast metadata
        // changed. Refetching on every tab switch is the most common way an
        // app burns battery and bandwidth for nothing.
        refetchOnWindowFocus: false,
        // Reconnecting *is* worth a refetch — the data may be from before an
        // outage.
        refetchOnReconnect: true,

        /**
         * Never withhold a request because the browser claims to be offline.
         *
         * The default (`'online'`) pauses a query whose retry is pending until
         * the online flag comes back — and `fetchStatus: 'paused'` still reads
         * as `status: 'pending'`, so the UI shows a loading state, no error,
         * and no way out. A query observed here sat paused indefinitely with
         * `navigator.onLine === true`, and dispatching an `online` event did
         * not release it.
         *
         * `navigator.onLine` was never a good proxy for "can reach our API"
         * anyway — it reports true behind a captive portal and lies in several
         * embedded browsers. Attempting the request and failing fast produces
         * an error a person can act on; pausing produces a spinner that never
         * resolves.
         */
        networkMode: 'always',

        retry: (failureCount, error) => {
          // Retrying a 404 or a validation failure is pure added latency.
          if (error instanceof ApiClientError) {
            return error.retryable && failureCount < 2;
          }
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  // On the server every request needs its own client, or one user's data
  // leaks into another's cache. In the browser it must be a singleton, or a
  // re-render throws away everything already fetched.
  if (typeof window === 'undefined') return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({
  children,
  locale,
}: {
  children: ReactNode;
  /** Resolved on the server, so client and server render the same words. */
  locale: SupportedLocale;
}) {
  const [queryClient] = useState(getQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {/*
        Animation features, supplied once for the whole tree.

        Components render `m.*` from `motion/react-m`, which is the element
        wrapper with *no* behaviour compiled in; this is where the behaviour
        comes from. The reason is bundle size: the full `motion` component
        bundles every feature it might need, including the projection engine
        that powers layout animation and drag. This app has no `layout` or
        `layoutId` anywhere — the mini→full player is one persistent component
        driven by a single value, deliberately, so nothing in the shell needs
        projection at all. It was arriving anyway, on every route.

        `domAnimation` is the subset actually used: transforms, opacity,
        variants, gestures, exit animations. Drag and projection stay out, and
        are pulled in only by the two routes that reorder a list — where the
        cost lands on the route that asked for it.

        Not `strict`: that mode throws on any full `motion` component rendered
        inside, and `Reorder` on those two routes is built out of them.
      */}
      <LazyMotion features={domAnimation}>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </LazyMotion>
    </QueryClientProvider>
  );
}
