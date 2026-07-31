"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Minus, Plus } from "lucide-react";
import { press } from "@/lib/motion/gestures";
import { cn } from "@/lib/utils";

/**
 * Manual correction for caption timing, on top of the automatic guess.
 *
 * The automatic offset works out how much advertising was stitched into the
 * download and assumes it all sits at the front (see caption-sync.ts). When a
 * show breaks mid-episode instead, that guess is wrong by the length of the
 * break — and the listener is the only one in a position to notice, because
 * they can hear it.
 *
 * So the guess is a starting point, not a verdict. A nudge is stored per
 * episode, because ad load differs between episodes and a correction for one
 * says nothing about the next.
 */

/**
 * Versioned, and deliberately bumped once already.
 *
 * A nudge is a correction *relative to* the automatic guess, so it only means
 * anything alongside the guess it was made against. Captions used to be shifted
 * by the gap between the audio's length and the transcript's even for AI
 * transcripts, where that gap is an outro rather than an ad break — and
 * listeners quite reasonably dialled in a nudge to cancel it. With the guess
 * gone (see captionOffsetFor) those nudges are no longer corrections; they are
 * the entire error, and a saved -16s now drags the captions sixteen seconds off
 * a transcript that was finally correct.
 *
 * Nothing stored under the old key can be reinterpreted, because whether it was
 * cancelling the guess or correcting a genuine mid-roll was never recorded. So
 * they are retired wholesale. Anyone who had a real correction makes it again
 * once; everyone else silently stops being wrong.
 */
const STORAGE_PREFIX = "cadence-caption-nudge:v2:";

/** One press. Small enough to land on a sentence, large enough to feel. */
const NUDGE_STEP = 1;

/** Beyond this the automatic guess is wrong, not slightly out. */
const MAX_NUDGE = 120;

function readNudge(episodeId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + episodeId);
    const value = raw == null ? 0 : Number(raw);
    return Number.isFinite(value) ? clampNudge(value) : 0;
  } catch {
    // Private mode, or storage disabled. The automatic offset still applies.
    return 0;
  }
}

function clampNudge(value: number): number {
  return Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, Math.round(value)));
}

/**
 * The listener's correction for this episode, and a way to change it.
 *
 * Read from storage in an effect rather than during render: the server has no
 * localStorage, and seeding state from it directly would make the first client
 * render disagree with the HTML.
 */
export function useCaptionOffset(episodeId: string) {
  const [nudge, setNudge] = useState(0);

  useEffect(() => {
    setNudge(readNudge(episodeId));
  }, [episodeId]);

  const adjust = useCallback(
    (delta: number) => {
      setNudge((current) => {
        const next = clampNudge(current + delta);
        try {
          if (next === 0) window.localStorage.removeItem(STORAGE_PREFIX + episodeId);
          else window.localStorage.setItem(STORAGE_PREFIX + episodeId, String(next));
        } catch {
          // Not being able to remember it is not a reason to refuse to do it.
        }
        return next;
      });
    },
    [episodeId],
  );

  const reset = useCallback(() => {
    setNudge(0);
    try {
      window.localStorage.removeItem(STORAGE_PREFIX + episodeId);
    } catch {
      /* ignore */
    }
  }, [episodeId]);

  return { nudge, adjust, reset };
}

export function CaptionSyncControl({
  auto,
  nudge,
  onAdjust,
  onReset,
}: {
  /** Seconds the app worked out on its own. */
  auto: number;
  /** Seconds the listener has added on top. */
  nudge: number;
  onAdjust: (delta: number) => void;
  onReset: () => void;
}) {
  const total = auto + nudge;

  return (
    <span className="flex items-center gap-1">
      <motion.button
        {...press}
        onClick={() => onAdjust(-NUDGE_STEP)}
        aria-label="Captions a second earlier"
        title="Captions a second earlier"
        className="grid size-6 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/15 hover:text-white"
      >
        <Minus className="size-3" />
      </motion.button>

      {/*
        Shows the shift being applied, and doubles as the reset. Naming the
        number matters: captions silently sliding by ten seconds looks like a
        bug, whereas "+10s" looks like a decision — and invites correction.
      */}
      <button
        onClick={onReset}
        disabled={total === 0}
        title={
          total === 0
            ? "Captions are aligned with the audio"
            : "Reset caption timing"
        }
        className={cn(
          "min-w-11 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums normal-case tracking-normal transition-colors",
          total === 0
            ? "text-white/40"
            : "bg-white/15 text-white hover:bg-white/25",
        )}
      >
        {total === 0 ? "in sync" : `${total > 0 ? "+" : ""}${total}s`}
      </button>

      <motion.button
        {...press}
        onClick={() => onAdjust(NUDGE_STEP)}
        aria-label="Captions a second later"
        title="Captions a second later"
        className="grid size-6 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/15 hover:text-white"
      >
        <Plus className="size-3" />
      </motion.button>
    </span>
  );
}
