import { ApiClientError, queryKeys } from '@cue/api-client';
import type { SessionUser } from '@cue/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './api';
import { clearToken, getToken, readOfflineSession, rememberVerifiedSession, setToken } from './auth-token';
import { isOnline } from './connectivity';
import { accountScope, bindAccountCache } from './account';
import { resetQueue, setSyncState } from './player/store';
import { watchSessionLifecycle } from './session-lifecycle';

/**
 * The current session.
 *
 * Anonymous is a first-class state, not an error: browsing, searching and
 * playing all work signed-out, and only the library needs an account. So this
 * returns `user: null` rather than throwing, and no screen has to guard
 * against a rejected promise just to render.
 */
export function useSession() {
  const queryClient = useQueryClient();
  useEffect(() => watchSessionLifecycle(queryClient), [queryClient]);
  bindAccountCache(queryClient);
  const { data, isPending } = useQuery({
    queryKey: queryKeys.session,
    queryFn: async ({ signal }: { signal?: AbortSignal } = {}) => {
      const offline = readOfflineSession();
      if (!isOnline() && offline) return offline;
      const token = getToken(); const owner = accountScope.snapshot();
      const controller = new AbortController(); let timedOut = false;
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const deadline = setTimeout(() => { timedOut = true; abort(); }, 15_000);
      try {
        const result = await api.getMe(controller.signal);
        await rememberVerifiedSession(result, token, owner);
        return result;
      } catch (error) {
        // A temporary outage may use the previous verified identity only until
        // its server-issued expiry. Auth rejection clears it in api.ts.
        const retained = accountScope.matches(owner) ? readOfflineSession() : null;
        if (retained && !(error instanceof ApiClientError && !error.retryable)
          && !signal?.aborted && (timedOut || !(error instanceof Error) || error.name !== 'AbortError')) return retained;
        throw error;
      } finally {
        clearTimeout(deadline); signal?.removeEventListener('abort', abort);
      }
    },
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
  bindAccountCache(queryClient);

  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      await clearToken();
      const owner = accountScope.snapshot();
      const result = await api.signIn(input);
      if (!accountScope.matches(owner)) throw Object.assign(new Error('The account changed'), { name: 'AbortError' });
      // Stored before the cache is invalidated, so the refetch that follows
      // is already carrying the new token rather than racing it.
      if (result.token) await setToken(result.token);
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.session }),
  });
}

export function useVerifyEmail() {
  const queryClient = useQueryClient();
  bindAccountCache(queryClient);
  return useMutation({
    mutationFn: async (input: { email: string; otp: string }) => {
      await clearToken();
      const owner = accountScope.snapshot();
      const result = await api.verifyEmail(input);
      if (!accountScope.matches(owner)) throw Object.assign(new Error('The account changed'), { name: 'AbortError' });
      if (result.token) await setToken(result.token);
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.session }),
  });
}

export function useSignUp() {
  const queryClient = useQueryClient();
  bindAccountCache(queryClient);

  return useMutation({
    mutationFn: async (input: { email: string; password: string; name: string }) => {
      await clearToken();
      const owner = accountScope.snapshot();
      const result = await api.signUp(input);
      if (!accountScope.matches(owner)) throw Object.assign(new Error('The account changed'), { name: 'AbortError' });
      if (result.token) await setToken(result.token);
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.session }),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  bindAccountCache(queryClient);

  return useMutation({
    mutationFn: async () => {
      // The local token goes first. If the network call fails, the device is
      // still signed out — the alternative leaves someone looking at a Sign
      // out button that did nothing.
      const token = getToken();
      const clearing = clearToken();
      const owner = accountScope.snapshot();
      resetQueue();
      setSyncState('anonymous');
      queryClient.setQueryData(queryKeys.session, { user: null });
      await clearing;
      await api.signOut(token).catch(() => undefined);
      return owner;
    },
    onSuccess: (owner) => {
      if (!accountScope.matches(owner)) return;
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
