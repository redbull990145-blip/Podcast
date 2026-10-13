import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const directory = join(root, 'packages/db/migrations');
const forward = readFileSync(join(root, 'docs/remediation/stage-2-forward.sql'), 'utf8');
const executable = readFileSync(join(directory, '0016_transcription_leases.sql'), 'utf8');
const rollback = readFileSync(join(root, 'docs/remediation/stage-2-rollback.sql'), 'utf8');
async function isolated(populated = false) {
  const db = new PGlite();
  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith('.sql') && f < '0016')
    .sort())
    await db.exec(readFileSync(join(directory, file), 'utf8'));
  if (populated) {
    await db.exec(
      "INSERT INTO users(id,name,email) VALUES ('legacy-owner','Legacy','legacy@isolated.test'); INSERT INTO ai_usage(user_id,day,count) VALUES ('legacy-owner','2020-01-01',7); INSERT INTO podcasts(id,feed_url,title) VALUES ('00000000-0000-4000-8000-000000000001','https://isolated.test/feed','Legacy');",
    );
    for (const [i, status] of ['queued', 'running', 'failed'].entries()) {
      const id = `00000000-0000-4000-8000-00000000001${i}`;
      await db.query(
        "INSERT INTO episodes(id,podcast_id,guid,title,audio_url,published_at) VALUES ($1,'00000000-0000-4000-8000-000000000001',$2,'Legacy','https://isolated.test/audio',now())",
        [id, status],
      );
      await db.query(
        "INSERT INTO transcription_jobs(episode_id,user_id,quota_day,status,attempts) VALUES ($1,'legacy-owner','2020-01-01',$2,3)",
        [id, status],
      );
    }
  }
  return db;
}
const jobs = async (db: PGlite) =>
  (await db.query('SELECT * FROM transcription_jobs ORDER BY episode_id')).rows;
const columns = async (db: PGlite) =>
  (
    await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='transcription_jobs'",
    )
  ).rows.map((r) => r.column_name);

describe('exact approved migration and rollback on isolated PGlite', () => {
  it('keeps both SQL files identical to the approved proposal', () => {
    const proposal = readFileSync(
      join(root, 'docs/remediation/stage-2-migration-proposal.md'),
      'utf8',
    );
    const blocks = [...proposal.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(forward).toBe(blocks[0]);
    expect(rollback).toBe(blocks[1]);
    // The runner owns BEGIN/COMMIT; the DDL and timeouts remain exactly approved.
    expect(executable.replaceAll('--> statement-breakpoint', '').replace(/\s+/g, ' ').trim()).toBe(
      forward
        .replace(/^BEGIN;\s*/, '')
        .replace(/\s*COMMIT;\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  });
  it('applies exact forward and rollback SQL to a fresh database', async () => {
    const db = await isolated();
    try {
      const before = await columns(db);
      await db.exec(forward);
      expect(await columns(db)).toEqual(
        expect.arrayContaining(['lease_token', 'funding_source', 'quota_state']),
      );
      await db.exec(rollback);
      expect(await columns(db)).toEqual(before);
      expect(await jobs(db)).toEqual([]);
    } finally {
      await db.close();
    }
  });
  it('preserves populated legacy rows and quota counters in both directions', async () => {
    const db = await isolated(true);
    try {
      const before = await jobs(db);
      const counters = (await db.query('SELECT * FROM ai_usage')).rows;
      await db.exec(forward);
      const after = (await jobs(db)) as Record<string, unknown>[];
      for (const row of after)
        expect(row).toMatchObject({
          funding_source: 'legacy',
          quota_state: 'legacy',
          lease_token: null,
        });
      expect(
        after.map(({ funding_source: _f, quota_state: _q, lease_token: _l, ...row }) => row),
      ).toEqual(before);
      expect((await db.query('SELECT * FROM ai_usage')).rows).toEqual(counters);
      await db.exec(rollback);
      expect(await jobs(db)).toEqual(before);
      expect((await db.query('SELECT * FROM ai_usage')).rows).toEqual(counters);
    } finally {
      await db.close();
    }
  });
  it('enforces funding, quota and running-lease constraints without rejecting legacy rows', async () => {
    const db = await isolated(true);
    try {
      await db.exec(forward);
      const target = "WHERE episode_id='00000000-0000-4000-8000-000000000010'";
      for (const change of [
        "funding_source='unknown'",
        "quota_state='unknown'",
        "funding_source='byok',quota_state='unmetered'",
        "funding_source='operator',quota_state='reserved',quota_day=NULL",
        "funding_source='operator',quota_state='reserved',status='running',lease_token=NULL",
      ]) {
        await expect(
          db.exec(`UPDATE transcription_jobs SET ${change} ${target}`),
        ).rejects.toThrow();
      }
      await db.exec(
        `UPDATE transcription_jobs SET funding_source='byok',quota_state='unmetered',quota_day=NULL,status='running',lease_token='00000000-0000-4000-8000-000000000099' ${target}`,
      );
      expect((await jobs(db))[0]).toMatchObject({
        funding_source: 'byok',
        quota_state: 'unmetered',
        quota_day: null,
      });
    } finally {
      await db.close();
    }
  });
  it('rolls back DDL and legacy rows when an error occurs before forward commit', async () => {
    const db = await isolated(true);
    try {
      const before = await jobs(db);
      const originalColumns = await columns(db);
      await expect(db.exec(forward.replace('COMMIT;', 'SELECT 1 / 0; COMMIT;'))).rejects.toThrow();
      await db.exec('ROLLBACK;');
      expect(await columns(db)).toEqual(originalColumns);
      expect(await jobs(db)).toEqual(before);
      await db.exec(forward);
    } finally {
      await db.close();
    }
  });
  it('fails on unexpected pre-existing columns without leaving a partial migration', async () => {
    const db = await isolated(true);
    try {
      await db.exec('ALTER TABLE transcription_jobs ADD COLUMN lease_token text;');
      await expect(db.exec(forward)).rejects.toThrow();
      await db.exec('ROLLBACK;');
      expect(await columns(db)).not.toContain('funding_source');
      expect(await columns(db)).not.toContain('quota_state');
      expect(await jobs(db)).toHaveLength(3);
    } finally {
      await db.close();
    }
  });
  it('rolls back failed rollback SQL rather than removing dependencies with CASCADE', async () => {
    const db = await isolated(true);
    try {
      await db.exec(forward);
      const before = await jobs(db);
      await db.exec('CREATE VIEW stage2_dependency AS SELECT quota_state FROM transcription_jobs;');
      await expect(db.exec(rollback)).rejects.toThrow();
      await db.exec('ROLLBACK;');
      expect(await jobs(db)).toEqual(before);
      expect(await columns(db)).toContain('lease_token');
      await db.exec('DROP VIEW stage2_dependency;');
      await db.exec(rollback);
      expect(await columns(db)).not.toContain('lease_token');
    } finally {
      await db.close();
    }
  });
});
