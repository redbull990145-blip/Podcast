"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  estimateSeconds,
  progressAt,
  stageAt,
} from "@/lib/player/transcribe-stages";
import { TWEEN } from "@/lib/motion/config";

/**
 * Progress while captions are being generated.
 *
 * A spinner for a job that can run most of a minute tells someone nothing —
 * not whether it is working, nor roughly how long is left. This names the step
 * the server is actually on and fills a bar against a length estimated from the
 * episode's own duration. It is labelled as an estimate, and it deliberately
 * stops short of full until the work really finishes.
 */
export function TranscribeProgress({ durationSeconds }: { durationSeconds: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = performance.now();
    const interval = setInterval(() => {
      setElapsed((performance.now() - started) / 1000);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const estimate = estimateSeconds(durationSeconds);
  const progress = progressAt(elapsed, estimate);
  const percent = Math.round(progress * 100);
  const remaining = Math.max(0, Math.round(estimate - elapsed));
  const stage = stageAt(progress);

  return (
    <div className="grid flex-1 place-items-center px-6">
      <div className="w-full max-w-sm text-center">
        {/* The stage name crossfades as the job moves on, so the change is
            noticed by someone who isn't staring at it. */}
        <div className="grid text-sm font-medium">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={stage}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={TWEEN.fast}
              className="col-start-1 row-start-1"
            >
              {stage}
            </motion.p>
          </AnimatePresence>
        </div>

        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Generating captions"
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/15"
        >
          {/* scaleX, so a bar that ticks every 200ms for a minute never runs a
              layout pass to do it. */}
          <motion.div
            className="h-full w-full origin-left rounded-full bg-white"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: progress }}
            transition={TWEEN.slow}
          />
        </div>

        <p className="mt-2 text-xs tabular-nums opacity-55">
          {remaining > 0
            ? `About ${remaining}s left — you can keep listening`
            : "Taking a little longer than usual — still going"}
        </p>

        <p className="mt-4 text-xs leading-relaxed opacity-45">
          Long episodes are transcribed in pieces and stitched back together.
          Once this finishes, everyone gets these captions free.
        </p>
      </div>
    </div>
  );
}
