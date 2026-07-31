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
 * So the guess is a starting point, not a verdict — and a correction is
 * remembered for the whole show, not just the episode it was made on.
 *
 * That is not a convenience, it is what the measurements say. Elevation with
 * Steven Furtick serves files about nine seconds longer than its feed declares,
 * and cross-correlating the audio's speech envelope against the transcript's
 * puts the front insertion at 4.4s — the same 4.4s in every ten-minute window
 * of the episode, so it is a fixed pre-roll rather than a mid-roll break. The
 * remaining four-odd seconds are appended to the end.
 *
 * Nothing in the feed distinguishes those two halves. The total excess is
 * knowable; the split is not, short of decoding an hour of audio the browser
 * cannot even read cross-origin. But the split is a property of how the show's
 * host is configured, so it is the same on the next episode and the one after
 * — which makes one correction per show the right unit. Correct it once and
 * every episode of that show inherits it; correct a single episode that differs
 * and that episode wins.
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

/** Where a correction is kept for every future episode of the same show. */
const SHOW_PREFIX = "cadence-caption-nudge:show:v1:";

/** One press. Small enough to land on a sentence, large enough to feel. */
const NUDGE_STEP = 1;

/** Beyond this the automatic guess is wrong, not slightly out. */
const MAX_NUDGE = 120;

function read(key: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? clampNudge(value) : null;
  } catch {
    // Private mode, or storage disabled. The automatic offset still applies.
    return null;
  }
}

function write(key: string, value: number) {
  try {
    if (value === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
  } catch {
    // Not being able to remember it is not a reason to refuse to do it.
  }
}

/**
 * This episode's correction: its own if it has one, otherwise the show's.
 *
 * Episode beats show so that a one-off — a live special with a longer break, a
 * re-run with different advertising — can be fixed without moving everything
 * else off.
 */
function readNudge(episodeId: string, podcastId: string | null): number {
  const own = read(STORAGE_PREFIX + episodeId);
  if (own != null) return own;
  return (podcastId && read(SHOW_PREFIX + podcastId)) || 0;
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
export function useCaptionOffset(episodeId: string, podcastId: string | null) {
  const [nudge, setNudge] = useState(0);

  useEffect(() => {
    setNudge(readNudge(episodeId, podcastId));
  }, [episodeId, podcastId]);

  const adjust = useCallback(
    (delta: number) => {
      setNudge((current) => {
        const next = clampNudge(current + delta);
        write(STORAGE_PREFIX + episodeId, next);
        // The show carries the same correction forward, which is the point:
        // the insertion that made it necessary is the same next week.
        if (podcastId) write(SHOW_PREFIX + podcastId, next);
        return next;
      });
    },
    [episodeId, podcastId],
  );

  /**
   * Clears the show's correction as well as this episode's.
   *
   * Clearing only the episode would let the show's value reapply immediately,
   * so the display would read the same after pressing reset as before it —
   * which looks like a broken button rather than an inherited setting.
   */
  const reset = useCallback(() => {
    setNudge(0);
    write(STORAGE_PREFIX + episodeId, 0);
    if (podcastId) write(SHOW_PREFIX + podcastId, 0);
  }, [episodeId, podcastId]);

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
