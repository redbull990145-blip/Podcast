/**
 * Running an alignment once, and only once, per episode.
 *
 * An alignment is minutes of nobody's time and a handful of Whisper requests off
 * a shared allowance, so the two things that matter here are that two listeners
 * asking at the same moment produce one job, and that the answer is written
 * where everyone can read it rather than returned only to whoever asked.
 *
 * **The in-flight map is per process.** Behind more than one instance, two
 * simultaneous requests on different instances would each run a job — wasteful,
 * but not incorrect: both write the same column with the same kind of answer,
 * and the second simply overwrites the first with an equally good map. That is a
 * deliberately cheaper trade than adding a second queue table, and it is the one
 * place in this feature where scaling out costs quota rather than correctness.
 */

import type { FastifyInstance } from 'fastify';
import { claimQuota, refundQuota } from '../access.ts';
import { alignEpisode, type AlignOutcome } from './run.ts';

/** Episodes currently being aligned in this process, by id. */
const inFlight = new Map<string, Promise<AlignOutcome>>();

/**
 * How long the requesting client is kept waiting before being told to poll.
 *
 * Three probes is roughly twenty-five seconds — most of it the redirect walk
 * through the ad server rather than Whisper — so the common case finishes inside
 * this and the caller gets a real answer in one round trip. An episode that
 * needs bisecting runs on without them; the row is written either way, and the
 * transcript endpoint is where the result actually lives.
 */
const WAIT_MS = 40_000;

export type AlignRequestOutcome =
  | { started: true; outcome: AlignOutcome }
  /** Running, but not finished inside `WAIT_MS`. Poll the transcript. */
  | { started: true; outcome: null }
  | { started: false; detail: string };

export async function requestAlignment(
  app: FastifyInstance,
  episodeId: string,
  userId: string,
): Promise<AlignRequestOutcome> {
  const running = inFlight.get(episodeId);

  if (running) {
    // Joins the job already under way rather than starting a second one, and
    // costs this caller no quota — they are being given someone else's answer.
    return { started: true, outcome: await settle(running) };
  }

  // Publish the shared admission promise before yielding to quota I/O. Joining
  // callers share even a pending reservation and never pay for a second job.
  const job: Promise<AlignOutcome> = (async (): Promise<AlignOutcome> => {
    const { metered, day } = await claimQuota(app, userId);
    try {
      const outcome = await alignEpisode(app, episodeId, userId, {
        funding: metered ? 'operator' : 'byok',
      });

      /**
       * Refund anything that did not produce a correction.
       *
       * "In sync" costs no Whisper at all — it is settled by arithmetic on two
       * byte counts — and the others failed. Charging a daily allowance for a
       * question answered without spending it, or for an answer that could not
       * be given, is the kind of small unfairness `access.ts` is written to
       * avoid.
       */
      if (metered && day && outcome.status !== 'aligned') {
        await refundQuota(app, userId, day);
      }

      return outcome;
    } catch (error: unknown) {
      if (metered && day) await refundQuota(app, userId, day);
      return {
        status: 'failed',
        detail: error instanceof Error ? error.message : 'The alignment failed',
      };
    }
  })().finally(() => {
    if (inFlight.get(episodeId) === job) inFlight.delete(episodeId);
  });

  inFlight.set(episodeId, job);

  // Every caller observes this promise through settle's race. Admission errors
  // propagate to those callers; provider failures become the existing outcome.
  return { started: true, outcome: await settle(job) };
}

/** Whether an alignment is running for this episode in this process. */
export function isAligning(episodeId: string): boolean {
  return inFlight.has(episodeId);
}

async function settle(job: Promise<AlignOutcome>): Promise<AlignOutcome | null> {
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), WAIT_MS);
    timer.unref?.();
  });

  try {
    return await Promise.race([job, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
