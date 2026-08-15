'use client';

import { queryKeys } from '@cue/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * What the caption pane offers when the publisher shipped nothing.
 *
 * Which is most of the time — across this catalogue only about one episode in
 * seven declares a transcript, so this state is the common one and is written
 * as a real offer rather than an apology.
 *
 * Honest about all three costs before the button is pressed: it spends the
 * day's allowance, it takes minutes rather than seconds, and it needs an
 * account because an anonymous caller cannot be metered. Discovering any of
 * those *after* pressing is how a feature earns distrust.
 */
export function GenerateCaptions({
  episodeId,
  detail,
}: {
  episodeId: string;
  /** Why the last attempt produced nothing, when the server said. */
  detail?: string | null;
}) {
  const t = useTranslator();
  const queryClient = useQueryClient();
  const { isSignedIn } = useSession();

  /**
   * Poll only while something is actually running.
   *
   * `refetchInterval` returns false once the transcript is ready or has failed,
   * which stops the timer — a poll that outlives its job is a background
   * request every few seconds for as long as the tab stays open.
   */
  const { data } = useQuery({
    queryKey: queryKeys.episode.ai(episodeId),
    queryFn: ({ signal }) => api.getEpisodeAi(episodeId, { signal }),
    enabled: isSignedIn,
    refetchInterval: (query) =>
      query.state.data?.transcript.status === 'processing' ? 4000 : false,
  });

  const status = data?.transcript.status ?? null;
  const running = status === 'processing';

  // The captions themselves live under a different key, so finishing has to
  // invalidate them or the pane keeps showing this offer over a ready transcript.
  useEffect(() => {
    if (status === 'ready') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.episode.transcript(episodeId) });
    }
  }, [status, episodeId, queryClient]);

  const start = useMutation({
    mutationFn: () => api.transcribeEpisode(episodeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.episode.ai(episodeId) });
    },
  });

  const quota = data?.quota ?? null;
  const exhausted = quota ? quota.remaining <= 0 && !quota.byok : false;

  return (
    <div className="max-w-[var(--measure-prose)]">
      <p className="type-title3 m-0 text-[var(--color-text-primary)]">
        {t.t('captions.none')}
      </p>

      <p className="type-callout mt-2 mb-0 text-[var(--color-text-secondary)]">
        {running ? t.t('captions.working') : t.t('captions.noneBody')}
      </p>

      {detail && !running ? (
        <p className="type-caption mt-2 mb-0 text-[var(--color-text-tertiary)]">{detail}</p>
      ) : null}

      {!isSignedIn ? (
        // Not a paywall — a meter. Said plainly rather than hidden behind a
        // disabled button with no explanation.
        <p className="type-caption mt-4 mb-0 text-[var(--color-text-tertiary)]">
          {t.t('captions.signInToGenerate')}
        </p>
      ) : (
        <div className="mt-5">
          <Button
            onClick={() => start.mutate()}
            busy={start.isPending || running}
            disabled={running || exhausted}
          >
            {running ? t.t('captions.generating') : t.t('captions.generate')}
          </Button>

          <p className="type-caption mt-3 mb-0 text-[var(--color-text-tertiary)]">
            {exhausted
              ? t.t('captions.noAllowance')
              : quota
                ? t.t('captions.cost', { remaining: quota.remaining })
                : t.t('captions.costUnknown')}
          </p>
        </div>
      )}

      {start.error ? (
        <p className="type-caption mt-3 mb-0 text-[var(--color-danger)]">
          {start.error instanceof Error ? start.error.message : t.t('captions.failed')}
        </p>
      ) : null}
    </div>
  );
}
