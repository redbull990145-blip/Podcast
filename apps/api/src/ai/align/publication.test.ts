import { episodes, podcasts, transcripts, type Database } from '@cue/db';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/database.ts';
import { saveAlignment, type StoredAlignment, type VersionedTranscriptRow } from './run.ts';

let harness: TestDatabase;
let db: Database;
let app: FastifyInstance;
let observed: VersionedTranscriptRow;
let episodeId: string;
const alignment: StoredAlignment = {
  steps: [{ fromTranscriptMs: 0, offsetMs: 1000, bracketMs: [0, 0] }],
  anchors: [],
  confidence: 1,
  probes: 3,
  audioDurationMs: 5000,
  at: '2026-10-12T00:00:00Z',
};
beforeAll(async () => {
  harness = await createTestDatabase();
  db = harness as unknown as Database;
  app = { db } as FastifyInstance;
  const [podcast] = await db
    .insert(podcasts)
    .values({ feedUrl: 'https://isolated.test/alignment', title: 'Alignment' })
    .returning();
  const [episode] = await db
    .insert(episodes)
    .values({
      podcastId: podcast!.id,
      guid: 'alignment',
      title: 'Alignment',
      audioUrl: 'https://isolated.test/audio',
      publishedAt: new Date(),
    })
    .returning();
  episodeId = episode!.id;
});
beforeEach(async () => {
  await db.delete(transcripts);
  await db
    .insert(transcripts)
    .values({
      episodeId,
      source: 'feed',
      status: 'ready',
      revision: 1,
      fetchedAt: new Date('2026-10-12T00:00:00Z'),
      segments: [
        {
          index: 0,
          startMs: 0,
          endMs: 1000,
          text: 'Original cues',
          speaker: null,
        },
      ],
    })
    .returning();
  observed = await current();
});
afterAll(async () => harness.$close());
const current = async () =>
  (
    await db
      .select({
        ...getTableColumns(transcripts),
        fetchedAtVersion: sql<string>`to_char(${transcripts.fetchedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(transcripts)
      .where(eq(transcripts.episodeId, episodeId))
  )[0]!;
describe('alignment publication version fence on isolated PGlite', () => {
  it('publishes unchanged historical publisher timestamps without losing microseconds', async () => {
    await db.execute(
      sql`UPDATE ${transcripts} SET fetched_at = '2026-10-12T00:00:00.000123Z'::timestamptz WHERE episode_id = ${episodeId}`,
    );
    observed = await current();
    expect(await saveAlignment(app, observed, alignment)).toBe(true);
    expect((await current()).alignment).toEqual(alignment);
  });
  it('rejects a replacement differing only below millisecond precision', async () => {
    await db.execute(
      sql`UPDATE ${transcripts} SET fetched_at = '2026-10-12T00:00:00.000123Z'::timestamptz WHERE episode_id = ${episodeId}`,
    );
    observed = await current();
    await db.execute(
      sql`UPDATE ${transcripts} SET fetched_at = '2026-10-12T00:00:00.000456Z'::timestamptz WHERE episode_id = ${episodeId}`,
    );
    expect((await current()).fetchedAt.getTime()).toBe(observed.fetchedAt.getTime());
    expect(await saveAlignment(app, observed, alignment)).toBe(false);
    expect((await current()).alignment).toBeNull();
  });
  it('publishes the correction when the measured publisher row still exists', async () => {
    expect(await saveAlignment(app, observed, alignment)).toBe(true);
    expect((await current()).alignment).toEqual(alignment);
  });
  it.each([
    { source: 'generated' },
    { status: 'processing' },
    { revision: 2 },
    { fetchedAt: new Date('2026-10-12T00:00:01Z') },
    {
      segments: [
        {
          index: 0,
          startMs: 0,
          endMs: 1000,
          text: 'Replacement cues',
          speaker: null,
        },
      ],
    },
  ])('never applies the old map after a publisher row changes: %j', async (change) => {
    await db.update(transcripts).set(change).where(eq(transcripts.episodeId, episodeId));
    expect(await saveAlignment(app, observed, alignment)).toBe(false);
    expect((await current()).alignment).toBeNull();
  });
});
