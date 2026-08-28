/**
 * Which transcripts the re-timing pipeline is for.
 *
 * There are two kinds of transcript in this app and only one of them can be out
 * of sync in the way the pipeline fixes.
 *
 * **Publisher captions** arrive already timed, against a master the publisher
 * held before any advertisement was stitched into it. The listener is served a
 * different file — same episode, extra audio spliced in — so the cues are
 * correct about something nobody is playing. That is the case worth correcting,
 * and correcting it means finding where the inserted audio went.
 *
 * **Generated captions** were produced by transcribing audio this server
 * actually downloaded. Their timings already describe a real, stitched file. Not
 * necessarily *this* listener's file — ad insertion is per request — but running
 * them through the pipeline would re-time them against a third cut and make a
 * close answer worse. So they are excluded, and the manual nudge remains the
 * right and only tool for whatever is left.
 *
 * Keeping the rule here rather than inline at each call site is what stops the
 * two from drifting: the server refuses work the client should never have
 * offered, and both should be reading the same sentence.
 */

import type { Transcript } from '@cue/types';

/** The shape this decision needs, so callers can pass a row or a wire object. */
export type AlignableTranscript = Pick<Transcript, 'source' | 'timed' | 'aligned'>;

/**
 * Whether re-timing this transcript could help.
 *
 * Deliberately says nothing about whether it is *currently* out of sync — that
 * needs the duration of the file being played, which only the client knows, and
 * the two questions have different answers at different moments. This one is a
 * property of the transcript alone and is stable for as long as it exists.
 */
export function canAlign(transcript: AlignableTranscript | null | undefined): boolean {
  if (!transcript) return false;

  // Only the publisher's own timings describe an un-stitched master.
  if (transcript.source !== 'feed') return false;

  // Untimed HTML prose, which is most of what publishers ship, has no timeline
  // to correct. Aligning it would move zeroes around.
  if (!transcript.timed) return false;

  // Already corrected. Doing it twice would measure the audio against cues that
  // have already been moved onto it and find, correctly, that they now match.
  return !transcript.aligned;
}

/**
 * Whether it is worth offering, given what the listener is actually playing.
 *
 * `driftMs` is the difference between the file in the player and the audio the
 * cues were timed against — the same figure the manual nudge is offered on. A
 * transcript that can be aligned but shows no drift is one where the arithmetic
 * already agrees, and spending a listener's daily allowance to confirm it would
 * be the most expensive way possible to learn nothing.
 *
 * Null drift means unknown, not zero: nothing has been measured, so the offer
 * stands rather than being silently withheld.
 */
export function shouldOfferAlignment(
  transcript: AlignableTranscript | null | undefined,
  driftMs: number | null,
): boolean {
  return canAlign(transcript) && driftMs !== 0;
}
