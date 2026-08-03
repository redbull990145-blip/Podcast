/**
 * Aligning a publisher transcript with the audio the listener actually got.
 *
 * Most large podcast hosts stitch advertising into the file at download time —
 * the URL for this app's test episode passes through Podtrac to Omny and comes
 * back from Triton carrying a `starship-rollup` marker, which is exactly that.
 * The published transcript, though, is timed against the clean master. So the
 * captions are correct relative to a file nobody is listening to, and every
 * line lands early by however much advertising was inserted ahead of it.
 *
 * Nothing in the feed says how much was inserted, or where. What we do have is
 * two durations that should agree and don't: the decoded audio, and the end of
 * the last caption. The difference is the inserted material.
 *
 * Placing it all at the front is an assumption, and it is the right one more
 * often than not — pre-roll is near-universal, and a mid-roll show would be
 * aligned up to the break anyway, so the error is bounded by the same number
 * either way. It is also why the offset is exposed as an adjustable value in
 * the UI rather than applied silently: when the guess is wrong, the listener
 * can see what was assumed and correct it.
 */

/**
 * Below this, the extra audio is the end of the episode, not advertising.
 *
 * This used to be 3 seconds, which was measured off the wrong thing and made
 * captions worse on every show it touched. Elevation with Steven Furtick is the
 * case that proved it: three episodes each came back exactly 8.73s longer than
 * the feed declares, which read as nine seconds of pre-roll and shifted every
 * caption nine seconds late.
 *
 * Decoding the file settles what those 8.73s actually are. Content runs to
 * 3514.0s and fades out by 3515.5s — the transcript's last word is at 3514.48s,
 * so the episode proper ends exactly where the transcript says. Then comes
 * digital silence at -74dB until 3518.5s, and then a separate four-second
 * segment at normal level before the file ends at 3523.2s. The inserted audio
 * is all of it at the *end*. Nothing was added to the front, and the correct
 * shift is zero.
 *
 * Which is the general case, not a quirk: every podcast ends with an outro,
 * sting or promo after the last word, so a small excess is what a normal
 * episode looks like. A pre-roll ad slot is a different order of magnitude —
 * fifteen seconds at the very least, usually thirty or more. Thirty seconds
 * sits above anything a show tacks onto its own ending and below any real ad
 * break, so the guess only fires when there is something substantial to
 * explain.
 *
 * Erring this way is also the cheaper mistake. Failing to correct a genuine
 * short pre-roll leaves captions a few seconds out and still readable, and the
 * listener can nudge them; shifting for an outro breaks captions on shows that
 * had nothing wrong with them.
 */
const NOISE_FLOOR_SECONDS = 30;

/** Above this, something other than an ad break is going on — don't guess. */
export const MAX_AUTO_OFFSET_SECONDS = 600;

/**
 * Seconds to subtract from playback position to get transcript position.
 *
 * Zero whenever the numbers don't support a confident answer: missing
 * durations, a transcript longer than the audio (which means the transcript is
 * for a different cut, not that ads were inserted), or a gap so large that
 * treating it as advertising would be wilder than leaving it alone.
 */
export function inferCaptionOffset(
  audioDuration: number,
  transcriptEnd: number,
): number {
  if (!Number.isFinite(audioDuration) || !Number.isFinite(transcriptEnd)) return 0;
  if (audioDuration <= 0 || transcriptEnd <= 0) return 0;

  const gap = audioDuration - transcriptEnd;
  if (gap <= NOISE_FLOOR_SECONDS) return 0;
  if (gap > MAX_AUTO_OFFSET_SECONDS) return 0;
  // A gap that is most of the episode means these two things are not the same
  // recording; shifting by it would be nonsense.
  if (gap > audioDuration / 2) return 0;

  return Math.round(gap);
}

/**
 * How much the audio has moved since a transcript was made from it.
 *
 * The AI-transcript counterpart to `inferCaptionOffset`, and it compares two
 * quite different things. That one measures a served file against a *master* it
 * has never seen, inferring the master's length from the feed. This one has both
 * numbers directly: the length we measured when we transcribed, and the length
 * the browser decoded now. If they disagree, the host served two different cuts
 * and the difference is the advertising that moved between them.
 *
 * Symmetric, unlike the publisher case, because both directions are real. A
 * later listener can get *fewer* seconds of advertising than the transcription
 * did, and then the captions need pulling earlier rather than later. There is no
 * equivalent on the publisher path — a transcript longer than the audio means
 * the transcript is for a different edit, not that time was removed.
 *
 * The same "it is all at the front" assumption applies here as there, with the
 * same bound on the error and the same escape hatch: see the note at the top of
 * this file, and caption-sync-control.tsx.
 */
export function inferRecutOffset(
  audioDuration: number,
  transcribedDuration: number | null | undefined,
): number {
  if (typeof transcribedDuration !== "number") return 0;
  if (!Number.isFinite(audioDuration) || !Number.isFinite(transcribedDuration)) return 0;
  if (audioDuration <= 0 || transcribedDuration <= 0) return 0;

  const gap = audioDuration - transcribedDuration;
  const magnitude = Math.abs(gap);

  // Below the floor this is measurement noise, not an ad break — the same
  // argument as NOISE_FLOOR_SECONDS, which is where the number comes from.
  if (magnitude <= NOISE_FLOOR_SECONDS) return 0;
  if (magnitude > MAX_AUTO_OFFSET_SECONDS) return 0;
  if (magnitude > audioDuration / 2) return 0;

  return Math.round(gap);
}

/**
 * The shift for a transcript from `source`.
 *
 * Two different measurements, because the two kinds of transcript are wrong in
 * two different ways.
 *
 * A **publisher** transcript is timed against the clean master, so it is
 * compared with the feed's declared duration — see `inferCaptionOffset`.
 *
 * An **AI** transcript was made from a file we fetched ourselves, and the
 * comment that used to sit here said that made its timings "already correct".
 * That holds only while the enclosure URL returns the same bytes twice, which on
 * a host that stitches advertising in at request time it does not. The
 * transcription read one cut; the listener streams another. So it is compared
 * against the length recorded at transcription time — see `inferRecutOffset`.
 *
 * Critically, this is *not* the same as comparing against the transcript's own
 * end, which is what the code did before and what threw every caption seconds
 * out of sync. A transcript ends at its last word; a file ends after the outro,
 * the sting and the trailing silence. The gap between those two is ordinary and
 * means nothing. `transcribedDuration` is a file length measured the same way
 * the browser measures one, so the comparison is like for like and a difference
 * really is a difference.
 *
 * Absent — every transcript generated before it was recorded — means no
 * evidence either way, and no evidence means no shift.
 */
export function captionOffsetFor(
  source: string | null,
  audioDuration: number,
  transcriptEnd: number,
  publishedDuration?: number | null,
  transcribedDuration?: number | null,
): number {
  if (source === "publisher") {
    return inferCaptionOffset(audioDuration, masterLength(transcriptEnd, publishedDuration));
  }
  return inferRecutOffset(audioDuration, transcribedDuration);
}

/**
 * How long the episode is without whatever the host stitched in — the number
 * the served file is compared against.
 *
 * The feed's own `<itunes:duration>` when there is one, because the transcript
 * is the wrong ruler: it stops at the last word spoken, so measuring against it
 * counts every episode's outro as though it were advertising. On the Elevation
 * episodes the two differ by exactly that outro — the feed says 3514s and the
 * transcript's last word lands at 3514.48s, while the file runs to 3523.2s.
 * Against the feed the excess is a clean 8.7s of appended material; against the
 * transcript it is the same 8.7s but now indistinguishable from a pre-roll.
 *
 * Falls back to the transcript when a feed omits its duration, which is common
 * enough to need handling and safe enough now that the floor is well above the
 * length of a normal ending.
 */
function masterLength(transcriptEnd: number, publishedDuration?: number | null): number {
  if (typeof publishedDuration === "number" && publishedDuration > 0) {
    return publishedDuration;
  }
  return transcriptEnd;
}

/** End of the last caption, or 0 for an empty transcript. */
export function transcriptEndSeconds(segments: { end: number }[]): number {
  if (segments.length === 0) return 0;
  return segments[segments.length - 1].end;
}

/** Playback position -> transcript position. Never negative. */
export function toTranscriptTime(currentTime: number, offset: number): number {
  return Math.max(0, currentTime - offset);
}

/** Transcript position -> playback position, for clicking a line to seek. */
export function toPlaybackTime(segmentStart: number, offset: number): number {
  return Math.max(0, segmentStart + offset);
}

/**
 * A correction that applies from one point in the episode onwards.
 *
 * ## Why one number was never enough
 *
 * Everything above treats the shift as a constant, and for a pre-roll it is: a
 * fixed block of advertising in front of the episode moves every caption by the
 * same amount. A mid-roll does not. A show with a pre-roll and two mid-rolls has
 * a shift that *steps* — thirty seconds until the first break, ninety after it,
 * a hundred and fifty after the second — and no single number is right in more
 * than one of those three stretches. Correcting the end throws out the start.
 *
 * So the correction is a list of steps instead. The listener presses the nudge
 * where they can hear the problem, and that press means "from here on, this
 * much" — which is exactly the shape of the thing being corrected.
 *
 * ## Why the listener has to be the one to say
 *
 * Nothing in the feed records where the breaks are or how long they ran, and
 * they differ per request on the hosts that do this. The obvious automatic
 * answer — line the audio's speech envelope up against the transcript's — needs
 * to read the samples, and these are precisely the hosts that send no CORS
 * headers, so the browser cannot. The listener can hear it, which is the one
 * detector available.
 */
export type CaptionAnchor = {
  /** Playback position, in seconds, from which `offset` applies. */
  at: number;
  /** Seconds to subtract from playback position to get transcript position. */
  offset: number;
};

/**
 * The shift in force at `playbackTime`.
 *
 * A step lookup: the last anchor at or before the position wins. Linear because
 * these lists are a handful of entries at most — an episode has as many
 * corrections as it has ad breaks the listener bothered to fix — and a binary
 * search over four items is slower than scanning them.
 *
 * Before the first anchor, the first anchor's own offset applies. `resolveAnchors`
 * guarantees one at zero so that case does not arise in the app; it is here so
 * the function is total.
 */
export function offsetAt(anchors: CaptionAnchor[], playbackTime: number): number {
  if (anchors.length === 0) return 0;

  let offset = anchors[0].offset;
  for (const anchor of anchors) {
    if (anchor.at > playbackTime) break;
    offset = anchor.offset;
  }
  return offset;
}

/** Playback position -> transcript position, under a stepped correction. */
export function transcriptTimeAt(
  anchors: CaptionAnchor[],
  playbackTime: number,
): number {
  return toTranscriptTime(playbackTime, offsetAt(anchors, playbackTime));
}

/**
 * Transcript position -> playback position, for clicking a line to seek.
 *
 * The inverse of `transcriptTimeAt`, and it cannot be a clean one. Each anchor
 * covers a stretch of playback, and inserting audio at a break means the
 * transcript stretches either side of it *overlap*: content just before a break
 * was heard once at its wrong (uncorrected) position and is reachable again at
 * its right one. A transcript time inside that overlap has two valid playback
 * positions and no arithmetic can pick between them.
 *
 * The later one wins. The listener corrected the timing precisely because the
 * later mapping is the true one for the part of the episode they are in, so
 * seeking forward past the break lands on the words they clicked; seeking back
 * would land on the stretch they had already decided was wrong.
 *
 * Outside an overlap — which is all of an episode bar a few seconds either side
 * of each break — this round-trips exactly.
 */
export function playbackTimeFor(
  anchors: CaptionAnchor[],
  transcriptTime: number,
): number {
  if (anchors.length === 0) return Math.max(0, transcriptTime);

  let answer: number | null = null;
  let resumesAt: number | null = null;

  for (let i = 0; i < anchors.length; i += 1) {
    const { at, offset } = anchors[i];
    const until = anchors[i + 1]?.at ?? Infinity;
    const candidate = transcriptTime + offset;

    // A stretch only answers for positions that actually fall inside it. Both
    // bounds matter: testing the upper one alone lets every later stretch claim
    // a position far behind its own start, which is how this first went wrong.
    if (candidate >= at && candidate < until) {
      answer = candidate;
      continue;
    }

    /*
     * Falls before this stretch begins, and after the last one ended: these
     * words were spoken during audio that is not in this cut, so there is no
     * position that plays them. Answer with where the transcript picks up
     * again, which is the start of this stretch.
     */
    if (candidate < at && resumesAt === null) resumesAt = at;
  }

  // Past every stretch: the last anchor runs to the end of the episode.
  const last = anchors[anchors.length - 1];
  return Math.max(0, answer ?? resumesAt ?? transcriptTime + last.offset);
}

/**
 * The automatic guess and the listener's corrections, as one list of steps.
 *
 * Corrections are stored relative to the guess rather than as absolute shifts,
 * which is what makes them survive the guess getting better. A listener who
 * dialled in +4s against a guess of +30 meant "four more than whatever you
 * worked out", and if the guess is later revised to +34 by a better measurement
 * their correction should fall to zero rather than push the total to +68.
 *
 * Always returns at least one anchor, so callers never have to special-case an
 * episode nobody has corrected.
 */
export function resolveAnchors(
  auto: number,
  corrections: CaptionAnchor[],
): CaptionAnchor[] {
  if (corrections.length === 0) return [{ at: 0, offset: auto }];

  const sorted = [...corrections].sort((a, b) => a.at - b.at);

  // A correction made after seeking into the middle leaves the stretch before
  // it uncorrected, which is the guess on its own.
  const fromStart = sorted[0].at > 0 ? [{ at: 0, offset: 0 }, ...sorted] : sorted;

  return fromStart.map((anchor) => ({ at: anchor.at, offset: auto + anchor.offset }));
}

/** Beyond this the automatic guess is wrong, not slightly out. */
export const MAX_NUDGE_SECONDS = 120;

/**
 * How close two presses must be to count as one correction.
 *
 * Dialling in ten seconds takes ten presses and a few seconds of playback, and
 * without this each one would drop its own anchor a second apart — turning one
 * correction into a staircase. Sixty seconds is far longer than anyone spends
 * pressing a button and far shorter than the gap between two ad breaks, so it
 * separates the two cases without needing to know which is happening.
 */
export const ANCHOR_MERGE_WINDOW_SECONDS = 60;

/**
 * As many corrections as an episode can hold.
 *
 * A ceiling on what gets written to storage rather than a real limit on
 * anything: shows run three or four breaks, and past this the list has stopped
 * describing ad breaks and started recording someone playing with the buttons.
 * At the cap a press adjusts the stretch it lands in instead of splitting it,
 * so the control keeps working and simply stops adding steps.
 */
const MAX_ANCHORS = 16;

function clamp(value: number): number {
  return Math.max(-MAX_NUDGE_SECONDS, Math.min(MAX_NUDGE_SECONDS, Math.round(value)));
}

/**
 * Applies one press of the nudge control at playback position `at`.
 *
 * Three cases, and which one fires is what makes the control feel like it does
 * the obvious thing:
 *
 *  - **Nothing corrected yet.** The correction covers the episode from its
 *    start. Someone who nudges two minutes in means "the captions are late",
 *    not "the captions are late from two minutes in".
 *  - **A press continuing one the listener is already making.** Adjusts the
 *    same correction. This is what `lastPressAt` is for, and it is not the same
 *    test as "near the anchor": dialling in ten seconds twenty minutes into an
 *    episode is one decision, and measuring from the anchor at zero would call
 *    every press after the first a new one and leave a staircase behind.
 *  - **A press starting a new one.** Splits: the stretch behind keeps the
 *    correction it had, and a new one starts here. This is the mid-roll case,
 *    and it is the whole reason the list exists.
 */
export function applyNudge(
  corrections: CaptionAnchor[],
  delta: number,
  at: number,
  /** Where the listener was for their previous press, if they are mid-flow. */
  lastPressAt?: number | null,
): CaptionAnchor[] {
  const position = Math.max(0, Math.round(at));
  const sorted = [...corrections].sort((a, b) => a.at - b.at);

  if (sorted.length === 0) return [{ at: 0, offset: clamp(delta) }];

  // The stretch this position falls in.
  let index = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].at <= position) index = i;
  }
  const stretch = sorted[index];

  const continuing =
    typeof lastPressAt === "number" &&
    Math.abs(position - lastPressAt) <= ANCHOR_MERGE_WINDOW_SECONDS;

  const adjustInPlace =
    continuing ||
    // Standing on the anchor itself: there is nothing to split off.
    position - stretch.at <= ANCHOR_MERGE_WINDOW_SECONDS ||
    sorted.length >= MAX_ANCHORS ||
    // Before the first anchor: there is no earlier stretch to split off.
    position < stretch.at;

  if (adjustInPlace) {
    const next = [...sorted];
    next[index] = { at: stretch.at, offset: clamp(stretch.offset + delta) };
    return next;
  }

  return [...sorted, { at: position, offset: clamp(stretch.offset + delta) }].sort(
    (a, b) => a.at - b.at,
  );
}
