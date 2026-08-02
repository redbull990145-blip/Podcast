/**
 * How this app identifies itself to publishers.
 *
 * Identifying honestly rather than impersonating a browser is deliberate. Hosts
 * and CDNs block *unidentified* clients far more often than named ones, and a
 * podcast client that says what it is stays on the right side of the hosts whose
 * files it is asking for — which is also what the URL is for, so there is
 * somebody to contact when something looks wrong.
 */
export const USER_AGENT =
  "Cadence/0.1 (podcast app; +https://github.com/redbull990145-blip/Podcast)";

/**
 * Headers for a request that fetches a publisher's file.
 *
 * Episode audio has to carry this, and until now didn't. Buzzsprout — and it is
 * far from alone — answers a ranged request with no `user-agent` with a 403 and
 * an HTML block page, while serving the identical request with this string set.
 * The failure surfaced as "Couldn't download the episode audio" on an episode
 * that was playing in the tab at that moment, which reads like a contradiction
 * and isn't: playback streams from the browser, which sends its own
 * `user-agent`, while transcription fetches server-side, where nothing set one.
 */
export function publisherHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "user-agent": USER_AGENT, ...extra };
}
