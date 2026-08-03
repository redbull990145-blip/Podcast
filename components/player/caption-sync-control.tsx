"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Minus, Plus } from "lucide-react";
import { usePlayer } from "@/lib/player/store";
import {
  applyNudge,
  offsetAt,
  resolveAnchors,
  type CaptionAnchor,
} from "@/lib/player/caption-sync";
import { press } from "@/lib/motion/gestures";
import { cn } from "@/lib/utils";

/**
 * Manual correction for caption timing, on top of the automatic guess.
 *
 * The automatic offset works out how much advertising was stitched into the
 * download and assumes it all sits at the front (see caption-sync.ts). When a
 * show breaks mid-episode instead, that guess is wrong from the break onwards —
 * and the listener is the only one in a position to notice, because they can
 * hear it.
 *
 * So the guess is a starting point, not a verdict.
 *
 * ## One number per episode was not enough
 *
 * This used to store a single figure and add it to everything. That is the
 * right shape for a pre-roll and the wrong shape for the case it was written
 * for: a mid-roll break moves everything *after* it and nothing before, so one
 * number can be right at the start of an episode or right at the end, never
 * both. Fixing the end broke the start, which is why correcting a mid-roll show
 * felt like chasing the error around.
 *
 * It now stores a list of corrections, each applying from where it was made
 * onwards — the same shape as the thing being corrected. See `CaptionAnchor`.
 *
 * ## What carries to the next episode, and what cannot
 *
 * The *first* correction does. Elevation with Steven Furtick serves files about
 * nine seconds longer than its feed declares, and cross-correlating the audio's
 * speech envelope against the transcript's puts the front insertion at 4.4s —
 * the same 4.4s in every ten-minute window, so it is a fixed pre-roll. That is a
 * property of how the show's host is configured, so it is the same next week.
 *
 * The rest cannot. A mid-roll sits wherever this episode's break happened to
 * fall, and next week's episode is a different length with breaks in different
 * places — carrying "+60s from 22 minutes" onto it would be a guess dressed up
 * as a memory. So the show remembers the pre-roll and the episode remembers the
 * breaks.
 */

/**
 * Versioned, and deliberately bumped twice now.
 *
 * A nudge is a correction *relative to* the automatic guess, so it only means
 * anything alongside the guess it was made against. Two things have moved that
 * guess out from under the stored values:
 *
 * `v1` → `v2`: captions used to be shifted by the gap between the audio's length
 * and the transcript's even for AI transcripts, where that gap is an outro
 * rather than an ad break, and listeners quite reasonably dialled in a nudge to
 * cancel it. With that guess gone those nudges became the entire error.
 *
 * `v2` → `v3`: an AI transcript can now be shifted again, but on real evidence —
 * the length of the audio it was made from against the length being played (see
 * `captionOffsetFor`). A `v2` nudge cancelling the old drift would double up
 * against the new correction. The format changed from a number to a list at the
 * same time, so nothing could have been carried over regardless.
 *
 * Nothing stored under an old key can be reinterpreted, because whether a value
 * was cancelling a guess or correcting a genuine mid-roll was never recorded.
 * They are retired wholesale. Anyone who had a real correction makes it again
 * once; everyone else silently stops being wrong.
 */
const STORAGE_PREFIX = "cadence-caption-nudge:v3:";

/**
 * Where the pre-roll correction is kept for every future episode of the show.
 *
 * Only the first anchor's offset — a bare number, as before. Bumped alongside
 * the episode key for the `v2` → `v3` reason above.
 */
const SHOW_PREFIX = "cadence-caption-nudge:show:v2:";

/** One press. Small enough to land on a sentence, large enough to feel. */
const NUDGE_STEP = 1;

function readAnchors(key: string): CaptionAnchor[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    // Validated rather than trusted: this is user-editable storage, and a
    // malformed entry here would put NaN into the timeline every frame.
    const anchors = parsed
      .filter(
        (a): a is CaptionAnchor =>
          typeof a === "object" &&
          a !== null &&
          Number.isFinite((a as CaptionAnchor).at) &&
          Number.isFinite((a as CaptionAnchor).offset),
      )
      .map((a) => ({ at: Math.max(0, a.at), offset: a.offset }))
      .sort((a, b) => a.at - b.at);

    return anchors.length > 0 ? anchors : null;
  } catch {
    // Private mode, storage disabled, or a value that isn't JSON. The automatic
    // offset still applies.
    return null;
  }
}

function writeAnchors(key: string, anchors: CaptionAnchor[]) {
  try {
    // A single zero correction is the same as none; don't leave it behind.
    const meaningful = anchors.some((a) => a.offset !== 0);
    if (!meaningful) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(anchors));
  } catch {
    // Not being able to remember it is not a reason to refuse to do it.
  }
}

function readShowOffset(key: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeShowOffset(key: string, value: number) {
  try {
    if (value === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
  } catch {
    // As above.
  }
}

/**
 * This episode's corrections: its own if it has any, otherwise the show's
 * pre-roll as a single correction from the start.
 *
 * Episode beats show so that a one-off — a live special with a longer break, a
 * re-run with different advertising — can be fixed without moving every other
 * episode off.
 */
function readNudge(episodeId: string, podcastId: string | null): CaptionAnchor[] {
  const own = readAnchors(STORAGE_PREFIX + episodeId);
  if (own) return own;

  const show = podcastId ? readShowOffset(SHOW_PREFIX + podcastId) : 0;
  return show === 0 ? [] : [{ at: 0, offset: show }];
}

/**
 * The listener's corrections for this episode, and a way to change them.
 *
 * Read from storage in an effect rather than during render: the server has no
 * localStorage, and seeding state from it directly would make the first client
 * render disagree with the HTML.
 */
export function useCaptionOffset(episodeId: string, podcastId: string | null) {
  const [anchors, setAnchors] = useState<CaptionAnchor[]>([]);

  /**
   * Where the listener was for their last press.
   *
   * What separates "still dialling in the same correction" from "correcting a
   * different part of the episode" — see `applyNudge`. A ref rather than state
   * because nothing renders from it, and re-rendering the control on every
   * press to store a number it does not display would be work for nothing.
   */
  const lastPressAt = useRef<number | null>(null);

  useEffect(() => {
    setAnchors(readNudge(episodeId, podcastId));
    // A different episode is never a continuation of the previous one's flow.
    lastPressAt.current = null;
  }, [episodeId, podcastId]);

  const adjust = useCallback(
    (delta: number) => {
      /*
       * The live position, read at the moment of the press rather than
       * subscribed to. A correction means "from where I am now", so this needs
       * the current value — and subscribing to a number that republishes four
       * times a second, to read it on a button press, would re-render the
       * control continuously for the entire episode.
       */
      const at = usePlayer.getState().currentTime;
      const previous = lastPressAt.current;
      lastPressAt.current = at;

      setAnchors((current) => {
        const next = applyNudge(current, delta, at, previous);
        writeAnchors(STORAGE_PREFIX + episodeId, next);
        /*
         * Only the correction that starts at zero goes to the show. The rest
         * describe where *this* episode's breaks fell, and next week's are
         * somewhere else — see the note at the top of this file.
         */
        if (podcastId) {
          const preRoll = next.find((a) => a.at === 0)?.offset ?? 0;
          writeShowOffset(SHOW_PREFIX + podcastId, preRoll);
        }
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
    setAnchors([]);
    lastPressAt.current = null;
    writeAnchors(STORAGE_PREFIX + episodeId, []);
    if (podcastId) writeShowOffset(SHOW_PREFIX + podcastId, 0);
  }, [episodeId, podcastId]);

  return { anchors, adjust, reset };
}

/**
 * The shift in force right now, which moves as playback crosses a correction.
 *
 * Its own component because it is the one part of this control that depends on
 * the playback position, and the position republishes about four times a
 * second. Reading it here keeps those re-renders on a single span instead of on
 * the three buttons, the transcript header and everything else around them.
 */
function CurrentShift({ anchors }: { anchors: CaptionAnchor[] }) {
  const currentTime = usePlayer((s) => s.currentTime);
  const seconds = offsetAt(anchors, currentTime);

  if (seconds === 0) return <>in sync</>;
  return (
    <>
      {seconds > 0 ? "+" : ""}
      {seconds}s
    </>
  );
}

export function CaptionSyncControl({
  auto,
  corrections,
  onAdjust,
  onReset,
}: {
  /** Seconds the app worked out on its own. */
  auto: number;
  /** Corrections the listener has made on top, each from a point onwards. */
  corrections: CaptionAnchor[];
  onAdjust: (delta: number) => void;
  onReset: () => void;
}) {
  const anchors = useMemo(() => resolveAnchors(auto, corrections), [auto, corrections]);

  /*
   * Two different questions, and answering them with one flag is what made the
   * old version's reset look broken.
   *
   * `corrected` is whether the listener has anything of their own to clear —
   * and so whether pressing this does anything at all. Deliberately not "is the
   * shift currently zero": a correction of +30 before a break and 0 after it is
   * very much something they set, and the reset has to stay available while
   * they are listening to the stretch that happens to need no shift.
   *
   * `shifted` is whether the captions are being moved at all, by anyone, which
   * is what the number is reporting. An automatic shift with no correction on
   * top of it reads as active — because it is — while the reset stays disabled,
   * because there is nothing of the listener's under it to remove.
   */
  const corrected = corrections.some((c) => c.offset !== 0);
  const shifted = corrected || auto !== 0;
  const steps = corrections.length;

  return (
    <span className="flex items-center gap-1">
      <motion.button
        {...press}
        onClick={() => onAdjust(-NUDGE_STEP)}
        aria-label="Captions a second earlier from here"
        title="Captions a second earlier, from here on"
        className="grid size-6 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/15 hover:text-white"
      >
        <Minus className="size-3" />
      </motion.button>

      {/*
        Shows the shift being applied *here*, and doubles as the reset. Naming
        the number matters: captions silently sliding by ten seconds looks like
        a bug, whereas "+10s" looks like a decision — and invites correction.

        "Here" rather than "this episode" because with more than one correction
        there is no single answer, and the one worth showing is the one
        governing the words currently on screen.
      */}
      <button
        onClick={onReset}
        disabled={!corrected}
        title={
          corrected
            ? steps > 1
              ? `Reset caption timing (${steps} corrections)`
              : "Reset caption timing"
            : shifted
              ? "Shifted automatically for the advertising in this download"
              : "Captions are aligned with the audio"
        }
        className={cn(
          "min-w-11 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums normal-case tracking-normal transition-colors",
          shifted ? "bg-white/15 text-white" : "text-white/40",
          corrected && "hover:bg-white/25",
        )}
      >
        <CurrentShift anchors={anchors} />
        {/*
          A count, once there is more than one. Without it a shift that changes
          on its own part-way through an episode reads as the app drifting,
          which is the exact impression this control exists to dispel.
        */}
        {steps > 1 && <span className="ml-1 text-white/55">·{steps}</span>}
      </button>

      <motion.button
        {...press}
        onClick={() => onAdjust(NUDGE_STEP)}
        aria-label="Captions a second later from here"
        title="Captions a second later, from here on"
        className="grid size-6 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/15 hover:text-white"
      >
        <Plus className="size-3" />
      </motion.button>
    </span>
  );
}
