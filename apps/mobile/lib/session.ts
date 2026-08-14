import { queryKeys } from '@cue/api-client';
import type { SessionUser } from '@cue/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { clearToken, setToken } from './auth-token';
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
    staleTime: 5 * 60_000,
    retry: false,
  });

  return {
    user: data?.user ?? null,
    isSignedIn: Boolean(data?.user),
    isLoading: isPending,
  };
}

export function useSignIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const result = await api.signIn(input);
      // Stored before the cache is invalidated, so the refetch that follows
      // is already carrying the new token rather than racing it.
      await setToken(result.token);
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.session }),
  });
}

export function useSignUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { email: string; password: string; name: string }) => {
      const result = await api.signUp(input);
      await setToken(result.token);
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.session }),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // The local token goes first. If the network call fails, the device is
      // still signed out — the alternative leaves someone looking at a Sign
      // out button that did nothing.
      await clearToken();
      await api.signOut().catch(() => undefined);
    },
    onSuccess: () => {
      // Everything user-scoped in the cache belonged to the person who just
      // left. Clearing it wholesale is the only safe move — a stale library
      // rendering under the next person's session would be a data leak.
      queryClient.clear();
      // The queue lives in the player, not the cache, so it survives the line
      // above and has to be dropped by name.
      resetQueue();
      // Said here rather than left to the tab shell's effect: clearing the
      // cache puts the session query back into `isPending`, and the shell
      // holds its last answer while a query is in flight. Without this the
      // player would go on reporting progress to an account nobody is signed
      // into — with a token that has already been cleared.
      setSyncState('anonymous');
    },
  });
}

export type { SessionUser };
