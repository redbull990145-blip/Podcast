import {
  aiUsage,
  episodes,
  podcasts,
  transcriptionJobs,
  transcripts,
  userApiKeys,
  users,
  type Database,
} from '@cue/db';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.ts';
import { createTestDatabase, type TestDatabase } from '../test/database.ts';
import { encryptSecret } from './crypto.ts';
import { keyFor } from './access.ts';
import {
  admit,
  claimNext,
  complete,
  fail,
  heartbeat,
  jobFor,
  MAX_ATTEMPTS,
  type ClaimedJob,
} from './queue.ts';
import { assertJobSchema } from './queue-schema.ts';

let harness: TestDatabase;
let db: Database;
let app: FastifyInstance;
let episodeId: string;
let otherEpisode: string;
const encryption = 'isolated-settlement-encryption-secret';
const result = {
  segments: [{ index: 0, startMs: 0, endMs: 1000, text: 'verified', speaker: null }],
  audioDurationMs: 1000,
  audioBytes: 100,
};
beforeAll(async () => {
  harness = await createTestDatabase();
  db = harness as unknown as Database;
  app = {
    db,
    config: loadConfig({
      DATABASE_URL: 'pglite://memory',
      GROQ_API_KEY: 'operator-test-key',
      API_KEY_ENCRYPTION_SECRET: encryption,
      AI_DAILY_QUOTA: '2',
    }),
  } as FastifyInstance;
  await db.insert(users).values([
    { id: 'A', name: 'A', email: 'a@isolated.test' },
    { id: 'B', name: 'B', email: 'b@isolated.test' },
  ]);
  const [show] = await db
    .insert(podcasts)
    .values({ feedUrl: 'https://isolated.test/feed', title: 'Isolated' })
    .returning();
  const rows = await db
    .insert(episodes)
    .values(
      ['one', 'two'].map((guid) => ({
        podcastId: show!.id,
        guid,
        title: guid,
        audioUrl: 'https://isolated.test/audio',
        publishedAt: new Date(),
      })),
    )
    .returning();
  episodeId = rows[0]!.id;
  otherEpisode = rows[1]!.id;
});
beforeEach(async () => {
  await db.delete(transcriptionJobs);
  await db.delete(transcripts);
  await db.delete(aiUsage);
  await db.delete(userApiKeys);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await harness.$close();
});
const usage = () => db.select().from(aiUsage);
const transcript = async () =>
  (await db.select().from(transcripts).where(eq(transcripts.episodeId, episodeId)))[0];
async function claimed(): Promise<ClaimedJob> {
  const job = await claimNext(db);
  expect(job).not.toBeNull();
  return job!;
}
async function expire() {
  await db
    .update(transcriptionJobs)
    .set({ heartbeatAt: sql`now() - interval '240 seconds'` })
    .where(eq(transcriptionJobs.episodeId, episodeId));
}
async function trigger(table: string, event: string, body: string, action: () => Promise<void>) {
  // Only literal test-owned table/event strings are passed by this file.
  await harness.$client.exec(
    `CREATE FUNCTION stage2_crash() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} RETURN NEW; END $$; CREATE TRIGGER stage2_crash BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION stage2_crash();`,
  );
  try {
    await action();
  } finally {
    await harness.$client.exec(
      `DROP TRIGGER stage2_crash ON ${table}; DROP FUNCTION stage2_crash();`,
    );
  }
}

describe('atomic admission and settlement on isolated PGlite', () => {
  it('clears a prior publisher alignment and measurement when generation replaces it', async () => {
    await db.insert(transcripts).values({ episodeId, source: 'feed', status: 'failed', segments: [], audioDurationMs: 9000, audioBytes: 999,
      alignment: { steps: [{ fromTranscriptMs: 0, offsetMs: 4000, bracketMs: [0, 1] }], anchors: [], confidence: 1, probes: 1, audioDurationMs: 9000, at: new Date().toISOString() } });
    await admit(app, episodeId, 'A');
    expect(await transcript()).toMatchObject({ alignment: null, audioDurationMs: null, audioBytes: null });
    const lease = await claimed();
    // Reproduce pre-existing metadata even when a worker completes after admission.
    await db.update(transcripts).set({ alignment: { steps: [], anchors: [], confidence: 1, probes: 1, audioDurationMs: 9000, at: new Date().toISOString() } }).where(eq(transcripts.episodeId, episodeId));
    expect(await complete(db, lease, result)).toBe(true);
    expect(await transcript()).toMatchObject({ alignment: null, audioDurationMs: 1000, audioBytes: 100 });
  });
  it('admits concurrent accounts and duplicates with one winning reservation', async () => {
    const outcomes = await Promise.all([
      admit(app, episodeId, 'A'),
      admit(app, episodeId, 'B'),
      admit(app, episodeId, 'A'),
    ]);
    expect(outcomes.filter((r) => r.started)).toHaveLength(1);
    const job = await jobFor(db, episodeId);
    expect(await usage()).toMatchObject([{ userId: job!.userId, day: job!.quotaDay, count: 1 }]);
  });
  it('never exceeds allowance across concurrent episode admissions', async () => {
    const limited = {
      ...app,
      config: { ...app.config, ai: { ...app.config.ai, dailyQuota: 1 } },
    } as FastifyInstance;
    const outcomes = await Promise.allSettled([
      admit(limited, episodeId, 'A'),
      admit(limited, otherEpisode, 'A'),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await usage()).toMatchObject([{ userId: 'A', count: 1 }]);
    expect(await db.select().from(transcriptionJobs)).toHaveLength(1);
  });
  it('does not admit or mutate transcript state at quota zero', async () => {
    const limited = {
      ...app,
      config: { ...app.config, ai: { ...app.config.ai, dailyQuota: 0 } },
    } as FastifyInstance;
    await expect(admit(limited, episodeId, 'A')).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(await usage()).toEqual([]);
    expect(await jobFor(db, episodeId)).toBeNull();
    expect(await transcript()).toBeUndefined();
  });
  it('hands concurrent claimers one lease', async () => {
    await admit(app, episodeId, 'A');
    expect((await Promise.all([claimNext(db), claimNext(db)])).filter(Boolean)).toHaveLength(1);
  });
  it('retains one reservation and attempts across transient retries and duplicates', async () => {
    await admit(app, episodeId, 'A');
    const first = await claimed();
    expect(await fail(db, first, 'temporary')).toEqual({
      owned: true,
      exhausted: false,
    });
    expect((await transcript())?.status).toBe('processing');
    expect((await admit(app, episodeId, 'B')).started).toBe(false);
    const second = await claimed();
    expect(second.attempts).toBe(2);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    expect(second.userId).toBe('A');
    expect(second.quotaDay).toBe(first.quotaDay);
    expect(await usage()).toMatchObject([{ userId: 'A', count: 1 }]);
  });
  it('fences replaced leases across a worker A–B–A sequence', async () => {
    await admit(app, episodeId, 'A');
    const oldA = await claimed();
    await expire();
    const workerB = await claimed();
    await expire();
    const newA = await claimed();
    for (const old of [oldA, workerB]) {
      expect(await heartbeat(db, old, { stage: 'saving', done: 99, total: 99 })).toBe(false);
      expect(await complete(db, old, result)).toBe(false);
      expect(await fail(db, old, 'stale', true)).toEqual({
        owned: false,
        exhausted: false,
      });
    }
    expect(await complete(db, newA, result)).toBe(true);
    expect((await transcript())?.status).toBe('ready');
    expect(await usage()).toMatchObject([{ count: 1 }]);
  });
  it('refunds an abandoned final attempt once with simultaneous recovery polls', async () => {
    await admit(app, episodeId, 'A');
    let last!: ClaimedJob;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      last = await claimed();
      await expire();
    }
    await Promise.all([claimNext(db), claimNext(db)]);
    expect(await jobFor(db, episodeId)).toMatchObject({
      status: 'failed',
      quotaState: 'refunded',
    });
    expect((await transcript())?.status).toBe('failed');
    expect(await usage()).toMatchObject([{ count: 0 }]);
    expect((await fail(db, last, 'late', true)).owned).toBe(false);
    expect(await usage()).toMatchObject([{ count: 0 }]);
  });
  it('allows one terminal settler and reads account/day from the locked row', async () => {
    await admit(app, episodeId, 'A');
    const lease = await claimed();
    const outcomes = await Promise.all([
      fail(db, { ...lease, userId: 'B', quotaDay: '2099-01-01' }, 'terminal', true),
      fail(db, lease, 'terminal', true),
    ]);
    expect(outcomes.filter((r) => r.owned)).toHaveLength(1);
    expect(await usage()).toMatchObject([{ userId: 'A', day: lease.quotaDay, count: 0 }]);
    expect(await jobFor(db, episodeId)).toMatchObject({
      userId: 'A',
      quotaDay: lease.quotaDay,
      quotaState: 'refunded',
    });
  });
  it('keeps success consistent when completion races terminal failure', async () => {
    await admit(app, episodeId, 'A');
    const lease = await claimed();
    const [saved, failed] = await Promise.all([
      complete(db, lease, result),
      fail(db, lease, 'terminal', true),
    ]);
    if (saved) {
      expect(failed.owned).toBe(false);
      expect((await transcript())?.status).toBe('ready');
      expect(await usage()).toMatchObject([{ count: 1 }]);
    } else {
      expect(failed.owned).toBe(true);
      expect((await transcript())?.status).toBe('failed');
      expect(await usage()).toMatchObject([{ count: 0 }]);
    }
  });
  it('does not recharge after committed success or refund a lost success response', async () => {
    await admit(app, episodeId, 'A');
    const lease = await claimed();
    await complete(db, lease, result);
    expect(await complete(db, lease, result)).toBe(false);
    expect((await fail(db, lease, 'lost response', true)).owned).toBe(false);
    expect((await admit(app, episodeId, 'B')).started).toBe(false);
    expect(await usage()).toMatchObject([{ userId: 'A', count: 1 }]);
  });
  it('preserves the original quota day across midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T23:59:00Z'));
    await admit(app, episodeId, 'A');
    const first = await claimed();
    await fail(db, first, 'temporary');
    vi.setSystemTime(new Date('2026-10-13T00:01:00Z'));
    const second = await claimed();
    expect(second.quotaDay).toBe('2026-10-12');
    await fail(db, second, 'terminal', true);
    expect(await usage()).toEqual([{ userId: 'A', day: '2026-10-12', count: 0 }]);
  });
  it('rejects old A leases after account B and a new A admission', async () => {
    await admit(app, episodeId, 'A');
    const oldA = await claimed();
    await fail(db, oldA, 'terminal', true);
    await admit(app, episodeId, 'B');
    const b = await claimed();
    await fail(db, b, 'terminal', true);
    await admit(app, episodeId, 'A');
    const newA = await claimed();
    expect(newA.leaseToken).not.toBe(oldA.leaseToken);
    expect(await complete(db, oldA, result)).toBe(false);
    expect((await fail(db, oldA, 'stale A', true)).owned).toBe(false);
    expect(await heartbeat(db, b)).toBe(false);
    expect(await complete(db, newA, result)).toBe(true);
    expect(await usage()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'A', count: 1 }),
        expect.objectContaining({ userId: 'B', count: 0 }),
      ]),
    );
  });
  it('never charges/refunds operator quota for BYOK, including removed keys', async () => {
    await db.insert(userApiKeys).values({
      userId: 'A',
      secret: encryptSecret('own-test-key', encryption),
      hint: 'test',
    });
    await admit(app, episodeId, 'A');
    const lease = await claimed();
    expect(lease.fundingSource).toBe('byok');
    await db.delete(userApiKeys);
    await expect(keyFor(app, 'A', lease.fundingSource)).rejects.toThrow(/requires your own/);
    await fail(db, lease, 'removed key', true);
    expect(await usage()).toEqual([]);
    expect(await jobFor(db, episodeId)).toMatchObject({
      quotaDay: null,
      quotaState: 'unmetered',
    });
  });
  it.each(['queued', 'running', 'failed'])(
    'quarantines %s legacy rows without touching their counters or transcript',
    async (status) => {
      await db.insert(aiUsage).values({ userId: 'A', day: '2020-01-01', count: 7 });
      await db
        .insert(transcriptionJobs)
        .values({ episodeId, userId: 'A', quotaDay: '2020-01-01', status });
      const before = await jobFor(db, episodeId);
      await expect(admit(app, episodeId, 'B')).rejects.toMatchObject({
        code: 'conflict',
      });
      expect(await claimNext(db)).toBeNull();
      expect(await jobFor(db, episodeId)).toEqual(before);
      expect(await usage()).toEqual([{ userId: 'A', day: '2020-01-01', count: 7 }]);
    },
  );
  it('never credits another account after the requesting account is deleted', async () => {
    await db.insert(users).values({
      id: 'deleted-requester',
      name: 'Deleted',
      email: 'deleted@isolated.test',
    });
    await admit(app, episodeId, 'deleted-requester');
    const lease = await claimed();
    await db.insert(aiUsage).values({ userId: 'B', day: lease.quotaDay!, count: 1 });
    await db.delete(users).where(eq(users.id, 'deleted-requester'));
    await fail(db, { ...lease, userId: 'B' }, 'account deleted', true);
    expect(await usage()).toEqual([{ userId: 'B', day: lease.quotaDay, count: 1 }]);
    expect(await jobFor(db, episodeId)).toMatchObject({
      userId: null,
      quotaDay: lease.quotaDay,
      quotaState: 'refunded',
    });
  });
  it('fails closed when required columns are missing, with isolated transaction rollback', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql.raw('ALTER TABLE transcription_jobs DROP COLUMN lease_token;'));
        await expect(assertJobSchema(tx as unknown as Database)).rejects.toMatchObject({
          code: 'upstream_unavailable',
        });
        throw new Error('rollback isolated schema change');
      }),
    ).rejects.toThrow('rollback isolated schema change');
    await expect(assertJobSchema(db)).resolves.toBeUndefined();
    expect(await usage()).toEqual([]);
  });
  it('rolls back reservation when job insertion crashes', async () => {
    await trigger(
      'transcription_jobs',
      'INSERT',
      "RAISE EXCEPTION 'injected admission crash';",
      async () => {
        await expect(admit(app, episodeId, 'A')).rejects.toThrow();
        expect(await usage()).toEqual([]);
        expect(await jobFor(db, episodeId)).toBeNull();
        expect(await transcript()).toBeUndefined();
      },
    );
  });
  it('rolls back transcript save when completion crashes before job deletion', async () => {
    await admit(app, episodeId, 'A');
    const lease = await claimed();
    await trigger(
      'transcription_jobs',
      'DELETE',
      "RAISE EXCEPTION 'injected completion crash';",
      async () => {
        await expect(complete(db, lease, result)).rejects.toThrow();
        expect((await transcript())?.status).toBe('processing');
        expect(await jobFor(db, episodeId)).toMatchObject({
          leaseToken: lease.leaseToken,
          status: 'running',
        });
        expect(await usage()).toMatchObject([{ count: 1 }]);
      },
    );
    expect(await complete(db, lease, result)).toBe(true);
  });
  it('rolls back a refund if settlement crashes and retries exactly once', async () => {
    await admit(app, episodeId, 'A');
    const lease = await claimed();
    await trigger(
      'transcription_jobs',
      'UPDATE',
      "IF NEW.quota_state = 'refunded' THEN RAISE EXCEPTION 'injected refund crash'; END IF;",
      async () => {
        await expect(fail(db, lease, 'terminal', true)).rejects.toThrow();
        expect(await usage()).toMatchObject([{ count: 1 }]);
        expect(await jobFor(db, episodeId)).toMatchObject({
          quotaState: 'reserved',
          status: 'running',
        });
      },
    );
    await fail(db, lease, 'terminal', true);
    await fail(db, lease, 'again', true);
    expect(await usage()).toMatchObject([{ count: 0 }]);
  });
  it('does not pretend to refund an absent original reservation counter', async () => {
    await admit(app, episodeId, 'A');
    const lease = await claimed();
    await db.delete(aiUsage);
    await expect(fail(db, lease, 'terminal', true)).rejects.toThrow();
    expect(await jobFor(db, episodeId)).toMatchObject({
      status: 'running',
      quotaState: 'reserved',
      leaseToken: lease.leaseToken,
    });
    expect((await transcript())?.status).toBe('processing');
  });
  it('fails closed when an approved schema constraint is weakened', async () => {
    await harness.$client.exec(
      'ALTER TABLE transcription_jobs DROP CONSTRAINT transcription_jobs_running_lease_check; ALTER TABLE transcription_jobs ADD CONSTRAINT transcription_jobs_running_lease_check CHECK (true);',
    );
    try {
      await expect(assertJobSchema(db)).rejects.toMatchObject({
        code: 'upstream_unavailable',
      });
      await expect(admit(app, episodeId, 'A')).rejects.toMatchObject({
        code: 'upstream_unavailable',
      });
      await expect(claimNext(db)).rejects.toMatchObject({
        code: 'upstream_unavailable',
      });
      expect(await usage()).toEqual([]);
    } finally {
      await harness.$client.exec(
        "ALTER TABLE transcription_jobs DROP CONSTRAINT transcription_jobs_running_lease_check; ALTER TABLE transcription_jobs ADD CONSTRAINT transcription_jobs_running_lease_check CHECK (funding_source = 'legacy' OR status <> 'running' OR lease_token IS NOT NULL);",
      );
    }
  });
});
