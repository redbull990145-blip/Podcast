import type { LibraryPodcast } from '@cue/types';

/**
 * Grouping the library by the listener's relationship to each show.
 *
 * The category default is an alphabetical grid of covers, which answers a
 * question nobody asks — you already know what you subscribed to. What you
 * actually want on opening this screen is: what is waiting for me, what is
 * still running, and what has quietly ended.
 *
 * Pure functions so the grouping is testable without rendering anything.
 */

export type LibraryGroup = {
  id: 'waiting' | 'running' | 'quiet';
  title: string;
  /** Shown under the heading when the group is empty of explanation. */
  caption: string;
  items: LibraryPodcast[];
};

/** A show with nothing published in this long has, in practice, stopped. */
const QUIET_AFTER_DAYS = 120;

function daysSince(iso: string | null, now: number): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return (now - time) / 86_400_000;
}

export function groupLibrary(
  items: LibraryPodcast[],
  now: number = Date.now(),
): LibraryGroup[] {
  const waiting: LibraryPodcast[] = [];
  const running: LibraryPodcast[] = [];
  const quiet: LibraryPodcast[] = [];

  for (const item of items) {
    if (item.newEpisodeCount > 0) {
      waiting.push(item);
    } else if (daysSince(item.lastPublishedAt, now) > QUIET_AFTER_DAYS) {
      quiet.push(item);
    } else {
      running.push(item);
    }
  }

  // Most waiting first — the number is the reason this group exists.
  waiting.sort((a, b) => b.newEpisodeCount - a.newEpisodeCount);
  // Most recently active first.
  running.sort(
    (a, b) => daysSince(a.lastPublishedAt, now) - daysSince(b.lastPublishedAt, now),
  );
  quiet.sort((a, b) => daysSince(a.lastPublishedAt, now) - daysSince(b.lastPublishedAt, now));

  const groups: LibraryGroup[] = [
    {
      id: 'waiting',
      title: 'Waiting for you',
      caption: 'New since you subscribed',
      items: waiting,
    },
    { id: 'running', title: 'Still going', caption: 'No new episodes right now', items: running },
    {
      id: 'quiet',
      title: 'Gone quiet',
      caption: `Nothing published in ${QUIET_AFTER_DAYS} days`,
      items: quiet,
    },
  ];

  // Empty groups are dropped rather than rendered as empty headings, which
  // would make a two-show library look like a mostly-broken screen.
  return groups.filter((group) => group.items.length > 0);
}
