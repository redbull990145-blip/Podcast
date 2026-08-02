import type { ContinueItem } from "@/lib/stats/listening";
import type { PlayableEpisode } from "@/lib/player/store";

/**
 * Turns a half-finished episode into something the player can load.
 *
 * `ContinueItem` already carries every field `PlayableEpisode` needs plus the
 * saved position, so this is a projection rather than a conversion. It exists
 * as a function anyway because two surfaces now resume the same episode — the
 * hero at the top of Home and the cards below it — and the previous version of
 * that code was an object literal written out longhand in the card. A second
 * copy of a literal like this does not fail loudly when the shapes drift; it
 * quietly stops passing `categories`, and the only visible symptom is that
 * recommendations get worse.
 *
 * Written as an explicit pick rather than a spread so that adding a field to
 * `ContinueItem` cannot silently widen what gets handed to the player.
 */
export function playableFromContinueItem(item: ContinueItem): PlayableEpisode {
  return {
    id: item.episodeId,
    title: item.title,
    enclosureUrl: item.enclosureUrl,
    durationSeconds: item.durationSeconds,
    artworkUrl: item.artworkUrl,
    podcastId: item.podcastId,
    podcastTitle: item.podcastTitle,
    categories: item.categories,
  };
}

/**
 * How far through an episode the saved position is, 0–1.
 *
 * Clamped at both ends, and 0 when the duration is unknown. Feeds a `scaleX`,
 * and a fill driven past 1 does not clip — it renders as a bar overflowing its
 * own track, which is how an unclamped progress value announces itself.
 */
export function progressFraction(item: ContinueItem): number {
  const duration = item.durationSeconds ?? 0;
  if (duration <= 0) return 0;
  return Math.min(1, Math.max(0, item.positionSeconds / duration));
}

/** Seconds left, or 0 when the duration is unknown. */
export function remainingSeconds(item: ContinueItem): number {
  const duration = item.durationSeconds ?? 0;
  return duration > 0 ? Math.max(0, duration - item.positionSeconds) : 0;
}
