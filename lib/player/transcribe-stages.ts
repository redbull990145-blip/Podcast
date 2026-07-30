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
 * Rough wall-clock estimate for transcribing an episode, in seconds.
 *
 * Measured against the real pipeline: a chunk of roughly twenty minutes of
 * audio takes a few seconds on an LPU-backed provider, and chunks run four at
 * a time, so throughput is far faster than real time. The floor covers the
 * fixed cost of the round trips for very short episodes.
 */
export function estimateSeconds(episodeSeconds: number): number {
  if (!Number.isFinite(episodeSeconds) || episodeSeconds <= 0) return 45;
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
