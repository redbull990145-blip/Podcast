/** Reconcile against the locked current row, including first-row creation. */
import { episodes, playbackProgress, type Database } from '@cue/db';
import { reconcileProgress, type ProgressRecord } from '@cue/core';
import { and, eq } from 'drizzle-orm';
import { notFound } from '../errors.ts';

export async function saveProgress(
  db: Database,
  userId: string,
  episodeId: string,
  incoming: ProgressRecord,
): Promise<ProgressRecord> {
  return db.transaction(async (tx) => {
    // An episode always exists before a progress row. Its lock serializes even
    // concurrent first writes; locking only progress would miss the absent row.
    const [episode] = await tx
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.id, episodeId))
      .for('update');
    if (!episode) throw notFound('Episode');
    const [stored] = await tx
      .select()
      .from(playbackProgress)
      .where(and(eq(playbackProgress.userId, userId), eq(playbackProgress.episodeId, episodeId)))
      .for('update');
    const current = stored
      ? {
          positionSec: stored.positionSec,
          durationSec: stored.durationSec,
          completed: stored.completed,
          deviceId: stored.deviceId,
          updatedAt: stored.updatedAt.getTime(),
        }
      : null;
    const winner = reconcileProgress(incoming, current)?.winner ?? incoming;
    const values = {
      positionSec: winner.positionSec,
      durationSec: winner.durationSec,
      completed: winner.completed,
      deviceId: winner.deviceId,
      updatedAt: new Date(winner.updatedAt),
    };
    await tx
      .insert(playbackProgress)
      .values({ userId, episodeId, ...values })
      .onConflictDoUpdate({
        target: [playbackProgress.userId, playbackProgress.episodeId],
        set: values,
      });
    return winner;
  });
}
