/**
 * Played / unplayed / in-progress classification.
 *
 * One definition, used by every surface that filters episodes. "Unplayed"
 * meaning subtly different things in different views is a genuine annoyance in
 * other apps, and the only way to avoid it is to have a single rule.
 */

export type EpisodeFilter = "all" | "unplayed" | "in_progress" | "played";

export type EpisodeProgress = {
  positionSeconds: number;
  played: boolean;
};

/**
 * Progress below this is treated as an accidental tap rather than a real start.
 *
 * Without it, brushing a play button moves an episode out of "unplayed" and it
 * effectively vanishes from the list someone is working through.
 */
export const IN_PROGRESS_FLOOR_SECONDS = 30;

export function matchesFilter(
  filter: EpisodeFilter,
  progress: EpisodeProgress | undefined,
): boolean {
  const position = progress?.positionSeconds ?? 0;
  const played = progress?.played ?? false;
  const started = !played && position > IN_PROGRESS_FLOOR_SECONDS;

  switch (filter) {
    case "unplayed":
      return !played && !started;
    case "in_progress":
      return started;
    case "played":
      return played;
    default:
      return true;
  }
}
