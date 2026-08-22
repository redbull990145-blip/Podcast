'use client';

import { QUESTION_MAX } from '@cue/validation';
import { formatTimestamp } from '@cue/core';
import type { AskCitation } from '@cue/types';
import { useRef, useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

/**
 * Ask a question, and watch it get answered.
 *
 * Streaming is the entire interaction design here. A grounded answer over a
 * whole transcript takes several seconds to write and about three hundred
 * milliseconds to *start*, and those two numbers are the difference between a
 * feature that feels like thinking and one that feels broken. So the answer
 * appears a word at a time, and there is no spinner — the text arriving is the
 * progress indicator.
 *
 * Citations land at the end rather than inline, because a `[42]` marker is
 * routinely split across two tokens; anything parsing mid-stream would drop
 * roughly the citations it exists for.
 */
export function AskBox({
  episodeId,
  disabled,
  onSeek,
}: {
  episodeId: string;
  disabled: boolean;
  onSeek: (ms: number) => void;
}) {
  const t = useTranslator();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<AskCitation[]>([]);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /** Lets a second question cancel the first rather than interleaving them. */
  const abort = useRef<AbortController | null>(null);

  const ask = async () => {
    const trimmed = question.trim();
    if (!trimmed || asking) return;

    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setAsking(true);
    setAnswer('');
    setCitations([]);
    setFailure(null);

    try {
      await api.askEpisode(episodeId, {
        question: trimmed,
        signal: controller.signal,
        onToken: (token) => setAnswer((previous) => previous + token),
        onCitations: setCitations,
      });
    } catch (error) {
      // An abort is this component's own doing — a second question, or leaving
      // the page. Reporting it as a failure would put an error under an answer
      // the reader deliberately replaced.
      if (!controller.signal.aborted) {
        setFailure(error instanceof Error ? error.message : t.t('ai.answerStopped'));
      }
    } finally {
      if (abort.current === controller) setAsking(false);
    }
  };

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
        className="flex flex-wrap items-center gap-3"
      >
        <label className="min-w-[240px] flex-1">
          <span className="sr-only">{t.t('ai.ask')}</span>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={QUESTION_MAX}
            disabled={disabled}
            placeholder={t.t('ai.askPlaceholder')}
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 type-callout text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus-visible:border-[var(--color-accent)] disabled:opacity-55"
          />
        </label>

        <Button type="submit" variant="secondary" busy={asking} disabled={disabled || !question.trim()}>
          {t.t('ai.askAction')}
        </Button>
      </form>

      {answer ? (
        <div className="mt-5">
          <p
            // Polite rather than assertive: the text grows a word at a time, and
            // an assertive region would interrupt a screen reader on every token.
            aria-live="polite"
            className="type-body m-0 max-w-[var(--measure-prose)] whitespace-pre-wrap text-[var(--color-text-secondary)]"
          >
            {answer}
            {asking ? <Caret /> : null}
          </p>

          {citations.length > 0 ? (
            <div className="mt-4">
              <p className="type-overline m-0 mb-2 text-[var(--color-text-tertiary)]">
                {t.t('ai.fromTranscript')}
              </p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {citations.map((citation) => (
                  <li key={citation.segmentIndex}>
                    <button
                      type="button"
                      onClick={() => onSeek(citation.startMs)}
                      className="flex w-full cursor-pointer items-baseline gap-3 rounded-[var(--radius-sm)] border-0 bg-transparent px-2 py-1.5 text-start transition-[transform,background-color] duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] active:scale-[0.98] motion-reduce:active:scale-100"
                    >
                      <span className="type-caption w-12 shrink-0 text-end text-[var(--color-accent-text)]">
                        {formatTimestamp(citation.startMs / 1000)}
                      </span>
                      <span className="type-caption line-clamp-2 text-[var(--color-text-tertiary)]">
                        {citation.text}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {failure ? (
        <p role="alert" className="type-caption mt-3 mb-0 text-[var(--color-danger)]">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

/** A cursor while the answer is still arriving, so a pause reads as thinking. */
function Caret() {
  return (
    <span
      aria-hidden="true"
      className="ms-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse bg-[var(--color-accent)] motion-reduce:animate-none"
    />
  );
}
