'use client';

import { queryKeys } from '@cue/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { accountScope } from '@/lib/account';
import type { AccountSnapshot } from '@cue/core';
import { useSession } from '@/lib/session';
import { useTranslator } from '@/components/i18n/locale-provider';

/**
 * Follow / unfollow.
 *
 * Fully optimistic: the label flips on the click, before the request is even
 * sent. Waiting ~200ms for a round trip to confirm something the user already
 * decided is the single most common way an app feels slow, and the server call
 * is idempotent precisely so this is safe.
 *
 * On failure the previous state is restored and the error surfaces — a silent
 * revert would leave someone believing they had followed a show they hadn't.
 */
export function SubscribeButton({ podcastId, tint }: { podcastId: string; tint?: string }) {
  const t = useTranslator();
  const { isSignedIn, isLoading } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();

  const key = queryKeys.library.isSubscribed(podcastId);

  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api.isSubscribed(podcastId),
    enabled: isSignedIn,
    staleTime: 60_000,
  });

  const subscribed = data?.subscribed ?? false;

  const toggle = useMutation({
    mutationFn: ({ next, owner }: { next: boolean; owner: AccountSnapshot }) => {
      if (!accountScope.matches(owner)) throw Object.assign(new Error('The account changed'), { name: 'AbortError' });
      return next ? api.subscribe(podcastId) : api.unsubscribe(podcastId);
    },

    onMutate: async ({ next, owner }) => {
      // Cancel any in-flight read, or it can land after this write and
      // overwrite the optimistic value with a stale one.
      await queryClient.cancelQueries({ queryKey: key });
      if (!accountScope.matches(owner)) throw Object.assign(new Error('The account changed'), { name: 'AbortError' });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, { subscribed: next });
      return { previous, owner };
    },

    onError: (_error, _next, context) => {
      if (context?.previous && accountScope.matches(context.owner)) queryClient.setQueryData(key, context.previous);
    },

    onSettled: (_data, _error, { owner }) => {
      if (!accountScope.matches(owner)) return;
      // The library's contents and this show's state both changed.
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.subscriptions() });
    },
  });

  if (isLoading) {
    // Reserve the space rather than popping a button in after the session
    // resolves — a control that appears late shifts everything beside it.
    return <div aria-hidden="true" className="h-[44px] w-[124px]" />;
  }

  if (!isSignedIn) {
    return (
      <Button variant="secondary" onClick={() => router.push('/signin')}>
        {t.t('podcast.signInToFollow')}
      </Button>
    );
  }

  return (
    <Button
      variant={subscribed ? 'secondary' : 'primary'}
      tint={subscribed ? undefined : tint}
      onClick={() => toggle.mutate({ next: !subscribed, owner: accountScope.snapshot() })}
      // The label is the state. "Following" tells you where you are; a checkbox
      // and a static word makes you work it out.
      aria-pressed={subscribed}
    >
      {subscribed ? t.t('podcast.following') : t.t('podcast.follow')}
    </Button>
  );
}
