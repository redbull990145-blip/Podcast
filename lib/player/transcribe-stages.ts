/**
 * Stage labels for the caption-generation progress bar.
 *
 * The transcription endpoint answers once, at the end — there is no progress
 * stream to read. So this reports the *pipeline* rather than pretending to
 * measure it: the stages are the real steps the server takes, in order, and
 * their timings come from how long each actually takes relative to episode
 * length. It is an estimate, and the UI says so rather than implying precision.
 *
 * The bar never reaches 100% on its own. It approaches the end of the final
 * stage and waits there until the response arrives, so it can't sit at
 * "finished" while the work is still running.
 */

export type Stage = {
  /** Fraction of the estimated total this stage ends at, 0-1. */
  until: number;
  label: string;
};

export const STAGES: Stage[] = [
  { until: 0.12, label: "Fetching the episode audio" },
  { until: 0.24, label: "Splitting it into chunks" },
  { until: 0.82, label: "Transcribing speech" },
  { until: 0.94, label: "Lining up the timings" },
  { until: 1, label: "Almost there" },
];

/**
 * How fast the server that will do the work actually is.
 *
 * These differ by an order of magnitude, which is far too much for one
 * estimate to cover: a bar paced for a hosted provider races to its asymptote
 * in the first minute of a job that takes fifteen, and then sits there looking
 * broken while everything is in fact fine.
 */
export type TranscriptionRate = "hosted" | "local";

/**
 * Rough wall-clock estimate for transcribing an episode, in seconds.
 *
 * "hosted" is measured against the real pipeline: a chunk of roughly twenty
 * minutes of audio takes a few seconds on an LPU-backed provider, and chunks
 * run four at a time, so throughput is far faster than real time.
 *
 * "local" is a developer's own GPU (see colab/README.md), which is nothing
 * like that. whisper-medium on a free-tier T4 runs at roughly twenty times
 * real time, and chunks are sent one or two at a time to stay inside the
 * tunnel's per-request limit — so a three-hour episode is a genuine
 * ten-to-fifteen minutes, and no cap applies, because there is no ceiling on
 * how long a long episode legitimately takes.
 *
 * The floor covers the fixed cost of the round trips for very short episodes.
 */
export function estimateSeconds(
  episodeSeconds: number,
  rate: TranscriptionRate = "hosted",
): number {
  const unknown = !Number.isFinite(episodeSeconds) || episodeSeconds <= 0;

  if (rate === "local") {
    // Unknown duration: assume something long rather than something short —
    // overshooting reads as "nearly done, hang on", undershooting as "stuck".
    if (unknown) return 600;
    return Math.max(30, episodeSeconds * 0.09 + 25);
  }

  if (unknown) return 45;
  return Math.min(120, Math.max(12, episodeSeconds * 0.02 + 8));
}

/** Progress 0-1, easing toward but never reaching the end while still running. */
export function progressAt(elapsedSeconds: number, estimateSeconds: number): number {
  if (estimateSeconds <= 0) return 0.95;
  const raw = elapsedSeconds / estimateSeconds;
  // Asymptotic: overrunning the estimate keeps creeping forward instead of
  // freezing at 100% and looking stuck.
  return Math.min(0.97, 1 - Math.exp(-1.6 * raw));
}

export function stageAt(progress: number): string {
  return (STAGES.find((s) => progress <= s.until) ?? STAGES[STAGES.length - 1]).label;
}
