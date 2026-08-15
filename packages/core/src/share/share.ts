/**
 * Sharing an episode, at a moment.
 *
 * "Listen to this bit" is the only social feature a single-listener podcast app
 * genuinely has. Nobody needs a follower graph to send a friend the three
 * minutes where the argument actually happens — they need a link that opens at
 * 24:31, and the difference between that and a bare episode link is the whole
 * feature.
 *
 * All of it is string handling, which is exactly the kind of code that looks
 * obviously correct and is not: a timestamp that round-trips wrong sends
 * someone to the wrong minute, and there is no error to notice.
 */

/**
 * Seconds as a readable URL fragment: `47s`, `24m31s`, `1h02m03s`.
 *
 * Readable rather than a raw count on purpose. `?t=1471` is shorter and tells a
 * person nothing; a link someone is about to paste into a message is read by
 * humans before it is read by the app, and `?t=24m31s` says where it goes.
 *
 * Minutes and seconds are zero-padded only when a larger unit precedes them, so
 * the common case stays tidy (`24m31s`) while the long case stays aligned
 * (`1h02m03s`).
 */
export function formatShareTime(positionSec: number): string {
  const total = Math.max(0, Math.floor(positionSec));

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
  }
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/**
 * Read a timestamp back, in any form it plausibly arrives in.
 *
 * Deliberately generous, because this value comes off a URL that a person may
 * well have edited by hand — and because links get shortened, re-typed, and
 * copied out of messages that mangled them. Accepted:
 *
 *   `1471`  `1471s`  `24m31s`  `24m`  `1h02m03s`  `1h`  `24:31`  `1:02:03`
 *
 * Anything else is null rather than zero. Zero is a real position — the start
 * of the episode — and returning it for an unparseable value would silently
 * turn a broken link into a link to the beginning.
 */
export function parseShareTime(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;

  const input = value.trim().toLowerCase();
  if (input.length === 0) return null;

  // `1471` or `1471s` — a bare count of seconds.
  const bare = /^(\d+)s?$/.exec(input);
  if (bare?.[1]) return clamp(Number(bare[1]));

  // `1h02m03s`, `24m31s`, `24m`, `1h`. At least one unit must be present, or
  // the pattern would happily match the empty string.
  const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(input);
  if (units && (units[1] ?? units[2] ?? units[3]) !== undefined) {
    return clamp(Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0));
  }

  // `24:31` or `1:02:03` — what someone copies straight off a scrubber.
  const colon = /^(?:(\d+):)?(\d+):(\d+)$/.exec(input);
  if (colon?.[2] && colon[3]) {
    return clamp(Number(colon[1] ?? 0) * 3600 + Number(colon[2]) * 60 + Number(colon[3]));
  }

  return null;
}

/** A day. Beyond this the value is a mistake, not an episode. */
const MAX_SHARE_SEC = 24 * 60 * 60;

function clamp(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_SHARE_SEC) return null;
  return seconds;
}

/**
 * Below this, a timestamp is noise.
 *
 * Sharing an episode "from 0:04" says nothing except that the sender had
 * pressed play. The link is better without it — and the person receiving it
 * gets the episode rather than a claim about a moment.
 */
export const MIN_SHARE_POSITION_SEC = 15;

/**
 * Whether a position is worth putting in the link.
 *
 * The far end matters as much as the near one: a link to the last thirty
 * seconds of an episode opens on the outro, which is never what anyone meant to
 * send. Both ends fall back to sharing the episode itself, which is always a
 * reasonable thing to have shared.
 */
export function shouldShareTime(positionSec: number, durationSec: number | null): boolean {
  if (!Number.isFinite(positionSec) || positionSec < MIN_SHARE_POSITION_SEC) return false;

  if (durationSec !== null && durationSec > 0) {
    if (durationSec - positionSec <= 30) return false;
  }

  return true;
}

/**
 * The link itself.
 *
 * Always an episode URL on the web, never a `cue://` deep link — even when the
 * share started on the phone. A scheme URL is unopenable for everyone who does
 * not already have the app, which is most of the people anyone shares with, and
 * a link that does nothing is worse than no share button.
 */
export function buildEpisodeShareUrl(
  origin: string,
  episodeId: string,
  positionSec: number | null,
): string {
  const base = `${origin.replace(/\/+$/, '')}/episode/${encodeURIComponent(episodeId)}`;
  if (positionSec === null) return base;

  return `${base}?t=${formatShareTime(positionSec)}`;
}

/**
 * The whole decision, in one call.
 *
 * Both clients need identical behaviour here — the same episode shared from the
 * phone and from the browser should produce the same link — so the rule about
 * *whether* to include a time lives with the rule about how to write it.
 */
export function episodeShareUrl(options: {
  origin: string;
  episodeId: string;
  /** Where playback is, if this episode is the one playing. */
  positionSec?: number | null;
  durationSec?: number | null;
}): string {
  const position = options.positionSec ?? null;
  const include =
    position !== null && shouldShareTime(position, options.durationSec ?? null);

  return buildEpisodeShareUrl(options.origin, options.episodeId, include ? position : null);
}
