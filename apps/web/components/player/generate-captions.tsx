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
  const progress = data?.transcript.progress ?? null;

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

      {running ? <Progress progress={progress} /> : null}

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

/**
 * How far the transcription has got.
 *
 * The fraction is real — chunks finished over chunks total, reported by the
 * process doing the work. It would have been easier to animate a bar on a timer
 * and let it creep toward 90%, and that is a lie told to someone who is waiting:
 * it moves when nothing is happening and it stops when everything is. On a long
 * episode the honest number sits still for thirty seconds at a time, which is
 * information — it says the model is working on a twenty-megabyte upload.
 *
 * Before the audio is split there is nothing to count, so the bar is
 * indeterminate and only the label carries the state. A determinate bar showing
 * 0% would claim we know we have done none of it, when what we know is that we
 * have not started measuring.
 */
function Progress({ progress }: { progress: { stage: string; done: number; total: number } | null }) {
  const t = useTranslator();

  const counted = progress !== null && progress.total > 0;
  const fraction = counted ? progress.done / progress.total : 0;

  const label = !progress
    ? t.t('captions.stageStarting')
    : progress.stage === 'fetching'
      ? t.t('captions.stageFetching')
      : progress.stage === 'splitting'
        ? t.t('captions.stageSplitting')
        : progress.stage === 'saving'
          ? t.t('captions.stageSaving')
          : // The last chunk is the one people watch, so it gets its own line
            // rather than reading "7 of 7" for however long it takes to land.
            counted && progress.done === progress.total - 1
            ? t.t('captions.stageAlmost')
            : t.t('captions.stageListening', { done: progress.done + 1, total: progress.total });

  return (
    <div className="mt-4 max-w-[36ch]">
      <div
        role="progressbar"
        aria-label={label}
        {...(counted
          ? { 'aria-valuenow': Math.round(fraction * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }
          : {})}
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border-strong)]"
      >
        {counted ? (
          <div
            className="h-full w-full origin-left rounded-full bg-[var(--color-accent)] transition-transform duration-[var(--duration-slow)] ease-standard"
            style={{ transform: `scaleX(${Math.max(0.02, fraction)})` }}
          />
        ) : (
          // Indeterminate: a short bar sweeping the track. Under reduced motion
          // the sweep is switched off in `globals.css` and the track simply
          // pulses, which still says "working" without anything travelling.
          <div className="h-full w-1/3 rounded-full bg-[var(--color-accent)] motion-safe:animate-[cue-sweep_1.6s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-pulse" />
        )}
      </div>

      <p className="type-caption mt-2 mb-0 text-[var(--color-text-secondary)]" aria-live="polite">
        {label}
      </p>
    </div>
  );
}
