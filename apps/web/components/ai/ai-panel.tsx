'use client';

import { queryKeys, type AiPanelState } from '@cue/api-client';
import { formatTimestamp, playableFromEpisode, seekTargetSec } from '@cue/core';
import type { Episode } from '@cue/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { AskBox } from '@/components/ai/ask-box';
import { api } from '@/lib/api';
import { usePlayerActions, usePlayerState } from '@/lib/player/store';

/**
 * What the model made of this episode.
 *
 * The panel's structure follows one rule: **nothing is generated without being
 * asked for.** Opening an episode page reads the shared cache and spends
 * nothing; every model call is behind a button that says what it will do. An
 * AI panel that generates on mount would burn a listener's daily allowance on
 * episodes they clicked into by accident.
 *
 * The order of what it offers is decided by the transcript, because everything
 * here reads one. Without a transcript there is nothing to summarise and the
 * only honest offer is to make one.
 */
export function AiPanel({
  episode,
  podcastTitle,
  podcastArtworkUrl,
  accentColor,
}: {
  episode: Episode;
  podcastTitle: string;
  podcastArtworkUrl: string | null;
  accentColor: string | null;
}) {
  const t = useTranslator();
  const client = useQueryClient();
  const state = usePlayerState();
  const { seek, play } = usePlayerActions();

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.episode.ai(episode.id),
    queryFn: ({ signal }) => api.getEpisodeAi(episode.id, { signal }),
    staleTime: 30_000,
  });

  const transcribing = data?.transcript.status === 'processing';

  /**
   * Poll only while a transcription is running.
   *
   * Transcription is the one operation here that finishes without the client
   * doing anything, so it is the only one that needs polling — and the interval
   * is removed the moment it lands rather than left running for the life of the
   * page.
   */
  useEffect(() => {
    if (!transcribing) return;

    const timer = setInterval(() => {
      void client.invalidateQueries({ queryKey: queryKeys.episode.ai(episode.id) });
      void client.invalidateQueries({ queryKey: queryKeys.episode.transcript(episode.id) });
    }, 5000);

    return () => clearInterval(timer);
  }, [transcribing, client, episode.id]);

  const refresh = (next: Partial<AiPanelState>) => {
    client.setQueryData<AiPanelState>(queryKeys.episode.ai(episode.id), (previous) =>
      previous ? { ...previous, ...next } : previous,
    );
  };

  const transcribe = useMutation({
    mutationFn: () => api.transcribeEpisode(episode.id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.episode.ai(episode.id) });
    },
  });

  const brief = useMutation({
    mutationFn: () => api.generateBrief(episode.id),
    onSuccess: (result) => {
      refresh({ summary: result.summary, takeaways: result.takeaways, quota: result.quota });
    },
  });

  const chapters = useMutation({
    mutationFn: () => api.generateChapters(episode.id),
    onSuccess: (result) => {
      refresh({ chapters: result.chapters, quota: result.quota });
    },
  });

  const isCurrent = state.current?.id === episode.id;

  /**
   * Jump to a moment, whether or not this episode is the one playing.
   *
   * Shared by chapters and by an answer's citations, because both are the same
   * gesture — "take me to where that was said" — and it must not seek a
   * different episode that happens to be playing.
   */
  const goTo = (ms: number) => {
    const target = seekTargetSec({ index: 0, startMs: ms, endMs: ms, text: '', speaker: null });

    if (isCurrent) {
      seek(target);
      return;
    }

    void play(
      playableFromEpisode(episode, {
        title: podcastTitle,
        artworkUrl: podcastArtworkUrl,
        accentColor,
      }),
    ).then(() => seek(target));
  };

  if (isPending) return <Muted>{t.t('common.loading')}</Muted>;

  // Signed out is the common case here and is not an error. Every AI call
  // spends money against an allowance, and an allowance needs someone to belong
  // to.
  if (error) {
    return <Muted>{t.t('ai.signedOutWeb')}</Muted>;
  }

  const { summary, takeaways, chapters: chapterList, transcript, quota } = data;

  const spent = !quota.byok && quota.remaining === 0;

  return (
    <div className="flex flex-col gap-8">
      <Allowance quota={quota} />

      {!transcript.present ? (
        <Block
          title={t.t('ai.noTranscript')}
          body={
            transcribing
              ? t.t('ai.transcribing')
              : t.t('ai.noTranscriptBody')
          }
        >
          {transcribing ? (
            <p className="type-caption m-0 text-[var(--color-text-tertiary)]" aria-live="polite">
              {t.t('ai.transcribingShort')}
            </p>
          ) : (
            <>
              <Button
                onClick={() => transcribe.mutate()}
                busy={transcribe.isPending}
                disabled={spent}
              >
                {t.t('ai.generateTranscript')}
              </Button>
              <Failure error={transcribe.error} />
            </>
          )}
        </Block>
      ) : null}

      {transcript.present ? (
        <>
          <Block
            title={t.t('ai.summary')}
            body={
              summary
                ? null
                : t.t('ai.summaryBody')
            }
          >
            {summary ? (
              <>
                <p className="type-body m-0 max-w-[var(--measure-prose)] text-[var(--color-text-secondary)]">
                  {summary}
                </p>

                {takeaways && takeaways.length > 0 ? (
                  <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
                    {takeaways.map((item) => (
                      <li
                        key={item}
                        className="type-callout relative max-w-[var(--measure-prose)] ps-5 text-[var(--color-text-secondary)] before:absolute before:start-0 before:text-[var(--color-accent-text)] before:content-['—']"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => brief.mutate()}
                  busy={brief.isPending}
                  disabled={spent}
                >
                  {t.t('ai.summarise')}
                </Button>
                <Failure error={brief.error} />
              </>
            )}
          </Block>

          <Block
            title={t.t('ai.chapters')}
            body={
              chapterList
                ? null
                : transcript.timed
                  ? t.t('ai.chaptersBody')
                  : t.t('ai.chaptersUntimed')
            }
          >
            {chapterList ? (
              <ol className="m-0 flex list-none flex-col p-0">
                {chapterList.map((chapter) => (
                  <li key={chapter.startMs}>
                    <button
                      type="button"
                      onClick={() => goTo(chapter.startMs)}
                      className="flex w-full cursor-pointer items-baseline gap-4 rounded-[var(--radius-sm)] border-0 bg-transparent px-2 py-2 text-start transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      <span className="type-caption w-12 shrink-0 text-end text-[var(--color-text-tertiary)]">
                        {formatTimestamp(chapter.startMs / 1000)}
                      </span>
                      <span className="type-body text-[var(--color-text-secondary)]">
                        {chapter.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : transcript.timed ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => chapters.mutate()}
                  busy={chapters.isPending}
                  disabled={spent}
                >
                  {t.t('ai.findChapters')}
                </Button>
                <Failure error={chapters.error} />
              </>
            ) : null}
          </Block>

          <Block
            title={t.t('ai.ask')}
            body={t.t('ai.askBody')}
          >
            <AskBox episodeId={episode.id} disabled={spent} onSeek={goTo} />
          </Block>
        </>
      ) : null}
    </div>
  );
}

/**
 * What the allowance is, and whose it is.
 *
 * Shown before anything is spent rather than after it runs out. A quota the
 * user only discovers by hitting it reads as a bait-and-switch; one they can
 * see reads as a budget.
 */
function Allowance({ quota }: { quota: AiPanelState['quota'] }) {
  const t = useTranslator();

  if (quota.byok) {
    return (
      <p className="type-caption m-0 text-[var(--color-text-tertiary)]">
        {t.t('ai.quotaByok', { hint: quota.hint ?? '' })}
      </p>
    );
  }

  if (!quota.operatorAvailable) {
    return (
      <p className="type-caption m-0 text-[var(--color-text-tertiary)]">
        {t.t('ai.quotaNoOperator')}
      </p>
    );
  }

  return (
    <p className="type-caption m-0 text-[var(--color-text-tertiary)]">
      {quota.remaining === 0
        ? t.t('ai.quotaSpent')
        : t.t('ai.quotaLeft', { count: quota.remaining })}
    </p>
  );
}

function Block({
  title,
  body,
  children,
}: {
  title: string;
  body: string | null;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="type-title3 mt-0 mb-1 text-[var(--color-text-primary)]">{title}</h3>
      {body ? (
        <p className="type-callout mt-0 mb-4 max-w-[var(--measure-prose)] text-[var(--color-text-tertiary)]">
          {body}
        </p>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A failed generation, said in the server's own words.
 *
 * The API distinguishes a spent quota from a rejected key from an episode with
 * no transcript, and each has a different fix. Replacing that with "Something
 * went wrong" would throw away the only part the reader can act on.
 */
function Failure({ error }: { error: unknown }) {
  const t = useTranslator();
  if (!error) return null;

  return (
    <p role="alert" className="type-caption mt-3 mb-0 text-[var(--color-danger)]">
      {error instanceof Error ? error.message : t.t('ai.failed')}
    </p>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p className="type-callout m-0 max-w-[var(--measure-prose)] text-[var(--color-text-secondary)]">
      {children}
    </p>
  );
}
