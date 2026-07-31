/**
 * Explaining why an episode wouldn't play.
 *
 * The browser gives us a single number, and the most common one is the least
 * informative: `MEDIA_ERR_SRC_NOT_SUPPORTED` covers both "this file was
 * fetched and cannot be decoded" and "this file was never fetched at all",
 * which need opposite responses from the listener. Reporting the first when it
 * was the second sends someone hunting for a codec problem that doesn't exist —
 * the BBC's `open.live.bbc.co.uk` fails to resolve on some ISPs, and the app
 * called that an audio format problem.
 *
 * So the message is refined once the host has been probed, not guessed from
 * the code alone.
 */

/** Numeric MediaError codes, named here so this module stays testable in Node. */
export const MEDIA_ERR = {
  ABORTED: 1,
  NETWORK: 2,
  DECODE: 3,
  SRC_NOT_SUPPORTED: 4,
} as const;

/**
 * First-pass explanation, from the code alone.
 *
 * The distinction that matters is "try again" versus "this file is not going to
 * play here" — a generic message leaves people retrying a dead link forever.
 */
export function describeMediaError(code: number | undefined): string {
  switch (code) {
    case MEDIA_ERR.ABORTED:
      return "Playback was interrupted. Press play to pick it back up.";
    case MEDIA_ERR.NETWORK:
      return "The connection dropped while loading this episode. Check your network and try again.";
    case MEDIA_ERR.DECODE:
      return "This episode's audio file appears to be corrupted. The publisher would need to re-upload it.";
    case MEDIA_ERR.SRC_NOT_SUPPORTED:
      return "This episode wouldn't load. Checking why…";
    default:
      return "This episode wouldn't load. The publisher's server may be down, or the file may have moved.";
  }
}

/** The host an episode's audio actually comes from, for use in a message. */
export function audioHost(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * The explanation once we know the host could not be reached at all.
 *
 * Names the host on purpose. Podcast audio is served by the publisher, not by
 * this app, and "we never reached publisher-host.example" is both the truth and
 * the only thing that points at a fix — a different network, or a complaint to
 * someone who can actually do something about it.
 */
export function unreachableMessage(url: string): string {
  const host = audioHost(url);
  return host
    ? `Couldn't reach ${host}, where this podcast's audio is hosted. That server may be down, or blocked by your network or ISP — other episodes from other shows should still play.`
    : "Couldn't reach the server hosting this episode's audio. It may be down, or blocked by your network.";
}

/** The explanation once we know the file arrived but the browser can't play it. */
export function undecodableMessage(): string {
  return "This browser can't play this episode's audio format. The publisher may have uploaded it in an unusual codec.";
}
