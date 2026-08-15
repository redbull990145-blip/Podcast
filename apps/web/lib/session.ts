'use client';

import { queryKeys } from '@cue/api-client';
import type { SessionUser } from '@cue/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from './api';
import { purgeCachedData } from './connectivity';
import { resetQueue, setSyncState } from './player/store';

/**
 * The current session.
 *
 * Anonymous is a first-class state, not an error: browsing, searching and
 * playing all work signed-out, and only the library needs an account. So this
 * returns `user: null` rather than throwing, and no screen has to guard
 * against a rejected promise just to render.
 */
export function useSession() {
  const { data, isPending } = useQuery({
    queryKey: queryKeys.session,
    queryFn: () => api.getMe(),
    // The session is read by nearly every screen; refetching it per navigation
    // would put a request in front of every page for information that changes
    // roughly never.
    staleTime: 5 * 60_000,
    retry: false,
  });

  return {
    user: data?.user ?? null,
    isSignedIn: Boolean(data?.user),
    isLoading: isPending,
  };
}

export function useSignOut() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => api.signOut(),
    onSuccess: () => {
      // Everything user-scoped in the cache belonged to the person who just
      // left. Clearing it wholesale is the only safe move — a stale library
      // rendering under the next person's session would be a data leak.
      queryClient.clear();
      // The queue lives in the player, not the cache, so it survives the line
      // above and has to be dropped by name.
      resetQueue();
      // And the service worker holds its own copy of every API response it has
      // seen, which outlives the tab entirely — the same leak, one layer down.
      purgeCachedData();
      // Said here rather than left to the shell's effect: clearing the cache
      // puts the session query back into `isPending`, and the shell holds its
      // last answer while a query is in flight. Without this the player would
      // go on reporting progress to an account nobody is signed into.
      setSyncState('anonymous');
      router.refresh();
    },
  });
}

export type { SessionUser };
