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
 * The shift for a transcript from `source`, which for most of them is none.
 *
 * `inferCaptionOffset` reads the gap between the audio and the transcript as
 * inserted advertising. That reading only makes sense for a transcript timed
 * against a different cut of the episode — a publisher's. An AI transcript was
 * made from this exact file, so its timings are already correct, and the same
 * gap means something ordinary instead: an outro, a sting, silence at the end.
 * Shifting for that threw every caption seconds out of sync.
 *
 * It showed up most on resuming mid-episode, which looked unrelated but isn't.
 * A variable-bitrate MP3 has no length until it has been fetched, so the
 * browser extrapolates one from the part it has — and seeking into the middle
 * is when that extrapolation is furthest off. The gap it implied, and so the
 * shift, changed depending on where playback started.
 */
export function captionOffsetFor(
  source: string | null,
  audioDuration: number,
  transcriptEnd: number,
  publishedDuration?: number | null,
): number {
  if (source !== "publisher") return 0;
  return inferCaptionOffset(audioDuration, masterLength(transcriptEnd, publishedDuration));
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
