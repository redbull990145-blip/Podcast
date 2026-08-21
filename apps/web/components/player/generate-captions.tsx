'use client';

import { queryKeys } from '@cue/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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

  /*
    The captions themselves live under a different key, so a change here has
    to invalidate them — otherwise the pane keeps showing this offer over a
    ready transcript, or keeps showing a `detail` from before this attempt
    ever started.

    Both terminal states, not only `ready`. The `detail` this component reads
    from its own `data` is the live one, current as of the last poll; the
    `detail` its *caller* passes in — `captions.tsx`'s own `getTranscript`
    query — is fetched once with `staleTime: Infinity` and was never going to
    refresh on its own. Missing the `failed` case here meant a fresh failure
    could still be showing whatever that query saw the last time it ran: on a
    first-ever attempt, nothing; after a previous attempt, that one's detail,
    left on screen under a button that now says something else happened.
  */
  useEffect(() => {
    if (status === 'ready' || status === 'failed') {
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
 *
 * **The elapsed clock is what actually answers "is this stuck?"** A sweep that
 * has looked the same for a fixed six-second loop for the last four minutes is
 * indistinguishable, by eye, from a job that died silently a few minutes ago —
 * which is exactly the shape of failure this was found next to: a long,
 * high-bitrate episode whose download alone can take well over a minute, during
 * which the old version of this had nothing to say beyond the one label it
 * started with. A number that keeps counting up is the one signal that survives
 * every stage looking identical to the one before it — it cannot lie about
 * whether time is passing, only about what is being done with it, and the label
 * beside it is what covers that half.
 */
function Progress({
  progress,
}: {
  progress: { stage: string; done: number; total: number; waitingUntilMs?: number } | null;
}) {
  const t = useTranslator();
  const elapsedSec = useElapsedSeconds();

  const waiting = progress?.stage === 'waiting';
  const resumesInSec = useCountdownSeconds(waiting ? (progress.waitingUntilMs ?? null) : null);

  const counted = progress !== null && progress.total > 0;
  const fraction = counted ? progress.done / progress.total : 0;

  /*
    A large episode gets a fuller sentence than "Fetching the audio", using the
    same estimate the transcribing stage's own label already trusts. Below the
    threshold it is not worth mentioning — every episode's download is a few
    seconds, and naming a chunk count for one that will finish before anyone
    reads the sentence is noise. Above it, the estimate is the one honest thing
    to say about a stage that otherwise reports nothing at all until it ends.
  */
  const longDownload = progress?.stage === 'fetching' && progress.total >= 4;

  /*
    The waiting stage says what is happening and, when it knows, when it ends.

    This is the one stage where a still bar is not the model working — it is
    the provider's shared allowance refilling, and nothing here can hurry it.
    Left unlabelled it was indistinguishable from a hang, which is precisely
    the report this came from: ten minutes of a bar that never moved, on a job
    that was in fact alive and would have finished.

    The countdown is the part that settles it. A number falling once a second
    cannot be mistaken for a frozen screen, and it converts an open-ended wait
    into one with a stated end — the difference between being stuck and being
    seventh in a queue.
  */
  const label = !progress
    ? t.t('captions.stageStarting')
    : progress.stage === 'waiting'
      ? resumesInSec !== null
        ? t.t('captions.stageWaitingIn', { time: formatElapsed(resumesInSec) })
        : t.t('captions.stageWaiting')
      : progress.stage === 'fetching'
        ? longDownload
          ? t.t('captions.stageFetchingLong')
          : t.t('captions.stageFetching')
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
          /*
            Held, and visibly dimmed, while waiting. The position is still the
            truth — those chunks are done and are not being redone — but a bar
            at full strength reads as work in progress, and during a wait it is
            the one thing on screen that is not happening.
          */
          <div
            className={`h-full w-full origin-left rounded-full bg-[var(--color-accent)] transition-[transform,opacity] duration-[var(--duration-slow)] ease-standard ${
              waiting ? 'opacity-40' : ''
            }`}
            style={{ transform: `scaleX(${Math.max(0.02, fraction)})` }}
          />
        ) : waiting ? (
          // Nothing counted yet and nothing moving: a still, dimmed track says
          // "paused" where the sweep below would claim progress.
          <div className="h-full w-full rounded-full bg-[var(--color-accent)] opacity-25" />
        ) : (
          // Indeterminate: a short bar sweeping the track. Under reduced motion
          // the sweep is switched off in `globals.css` and the track simply
          // pulses, which still says "working" without anything travelling.
          <div className="h-full w-1/3 rounded-full bg-[var(--color-accent)] motion-safe:animate-[cue-sweep_1.6s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-pulse" />
        )}
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-3">
        <p className="type-caption m-0 text-[var(--color-text-secondary)]" aria-live="polite">
          {label}
        </p>

        {/* Not `aria-live`: the label above already announces what changed,
            and a screen reader re-announcing a number every second would make
            this section unusable rather than informative. Sighted-only, and
            only once it has something worth saying — a few seconds elapsed is
            not information, it is the normal cost of a request round-trip. */}
        {elapsedSec >= 5 ? (
          <p
            aria-hidden="true"
            className="type-timecode m-0 shrink-0 text-[var(--color-text-tertiary)]"
          >
            {formatElapsed(elapsedSec)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Seconds since this component mounted, ticking once a second.
 *
 * Mounts and unmounts with the progress bar itself — `GenerateCaptions` only
 * renders this while `running` is true — so "since mount" and "since this
 * attempt started" are the same question. A `setInterval` at one second rather
 * than driving off the 4-second poll: the poll's own cadence is not a fact
 * about elapsed time, and ticking only on network responses landing would
 * itself look paused between them, on top of everything else already
 * indistinguishable stage to stage.
 */
function useElapsedSeconds(): number {
  const [elapsedSec, setElapsedSec] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    startRef.current = performance.now();
    const id = window.setInterval(() => {
      setElapsedSec(Math.floor((performance.now() - startRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return elapsedSec;
}

/**
 * Seconds until `deadlineMs`, ticking down; null when there is no deadline.
 *
 * Driven by a local interval against an absolute instant rather than by the
 * poll, for the same reason the server sends an instant in the first place: the
 * poll runs every four seconds, so a countdown advanced only on responses would
 * stand still three seconds in four and stutter on the fourth — a worse signal
 * than no countdown at all, since the thing it is trying to prove is that time
 * is passing.
 *
 * Clamped at zero rather than going negative. The wait ending and the next beat
 * arriving are two different moments, and the seconds between them should read
 * as "any moment now", not as a negative number counting away from a deadline
 * that has already gone.
 */
function useCountdownSeconds(deadlineMs: number | null): number | null {
  const [remainingSec, setRemainingSec] = useState<number | null>(null);

  useEffect(() => {
    if (deadlineMs === null) {
      setRemainingSec(null);
      return;
    }

    const read = () => setRemainingSec(Math.max(0, Math.round((deadlineMs - Date.now()) / 1000)));

    read();
    const id = window.setInterval(read, 1000);
    return () => window.clearInterval(id);
  }, [deadlineMs]);

  return remainingSec;
}

/** `1:04`, not `64s` — the same shape every other duration in this app takes. */
function formatElapsed(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
