'use client';

import { episodeShareUrl, formatTimestamp, shouldShareTime } from '@cue/core';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { useTransition } from '@/lib/motion';
import { usePlayerState } from '@/lib/player/store';

/**
 * Share this episode, from where you are in it.
 *
 * The only social feature a single-listener podcast app genuinely has. Nobody
 * needs a follower graph to send a friend the three minutes where the argument
 * actually happens — they need a link that opens at 24:31.
 *
 * The position is taken from the player only when *this* episode is the one
 * playing. Sharing the episode you are reading about with a timestamp from the
 * episode you are listening to would be a very confusing link to receive.
 */
export function ShareButton({ episodeId }: { episodeId: string }) {
  const t = useTranslator();
  const state = usePlayerState();
  const press = useTransition('responsive');

  const [copied, setCopied] = useState(false);

  const isCurrent = state.current?.id === episodeId;
  const position = isCurrent ? Math.floor(state.positionSec) : null;
  const withTime = position !== null && shouldShareTime(position, state.durationSec);

  const share = async () => {
    // The origin is read at click time rather than at build time: this app is
    // served from localhost, a preview URL and a domain, and a link that is
    // right on only one of them is worse than no share button.
    const url = episodeShareUrl({
      origin: window.location.origin,
      episodeId,
      positionSec: position,
      durationSec: state.durationSec,
    });

    /**
     * The OS sheet where there is one, the clipboard otherwise.
     *
     * `navigator.share` is the right control on a phone and absent on most
     * desktops. Its rejection is not an error worth reporting either — closing
     * the sheet rejects, and "sharing failed" after someone deliberately
     * cancelled is a lie.
     */
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url, title: state.current?.title ?? undefined });
        return;
      } catch {
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused outright — an insecure origin, a
      // permissions policy. Prompting with the URL is the honest fallback.
      window.prompt(t.t('share.failed'), url);
    }
  };

  return (
    <div className="relative">
      <m.button
        type="button"
        onClick={() => void share()}
        whileTap={{ scale: 0.97 }}
        transition={press}
        className="type-body flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-transparent px-5 text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 15V4M8.5 7.5 12 4l3.5 3.5M5 13v6.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V13" />
        </svg>

        {/* The label names the moment when there is one. A generic "Share" beside
            a playing episode hides the entire point of the feature. */}
        {withTime && position !== null
          ? t.t('share.fromHere', { time: formatTimestamp(position) })
          : t.t('share.action')}
      </m.button>

      <AnimatePresence>
        {copied ? (
          <m.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={press}
            role="status"
            className="type-caption absolute top-[calc(100%+6px)] start-0 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--color-surface-overlay)] px-2 py-1 text-[var(--color-text-secondary)]"
          >
            {t.t('share.copied')}
          </m.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
