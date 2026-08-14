import { queryKeys } from '@cue/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Button } from '@/components/button';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Follow or unfollow a show.
 *
 * Optimistic: the label flips on touch and reverts visibly if the write fails.
 * A subscribe button that waits for a round-trip on a mobile connection feels
 * broken even when it is working.
 */
export function SubscribeButton({ podcastId }: { podcastId: string }) {
  const { isSignedIn } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data } = useQuery({
    queryKey: queryKeys.library.isSubscribed(podcastId),
    queryFn: () => api.isSubscribed(podcastId),
    enabled: isSignedIn,
  });

  const subscribed = data?.subscribed ?? false;

  const mutation = useMutation({
    mutationFn: () =>
      subscribed ? api.unsubscribe(podcastId) : api.subscribe(podcastId),

    onMutate: async () => {
      const key = queryKeys.library.isSubscribed(podcastId);
      // Cancel first: an in-flight read that resolves after this write would
      // overwrite the optimistic value with the pre-write server state.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, { subscribed: !subscribed });
      return { previous };
    },

    onError: (_error, _variables, context) => {
      queryClient.setQueryData(
        queryKeys.library.isSubscribed(podcastId),
        context?.previous,
      );
    },

    onSettled: () => {
      // The library list now has one more or one fewer show in it.
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });

  if (!isSignedIn) {
    return (
      <Button
        label="Sign in to follow"
        variant="secondary"
        onPress={() => router.push('/signin')}
      />
    );
  }

  return (
    <Button
      label={subscribed ? 'Following' : 'Follow'}
      variant={subscribed ? 'secondary' : 'primary'}
      onPress={() => mutation.mutate()}
    />
  );
}
