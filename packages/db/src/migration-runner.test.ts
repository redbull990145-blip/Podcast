import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { schema, type Database } from './client.ts';
import { runMigrations, migrationsDir } from './migrate.ts';

describe('isolated migration runner transaction integration', () => {
  it('executes lease SQL on one transaction and records it idempotently', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as Database;
    try {
      const applied = await runMigrations(db);
      expect(applied).toContain('0016_transcription_leases.sql');
      expect(
        (
          await client.query(
            "SELECT name FROM __migrations WHERE name='0016_transcription_leases.sql'",
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await client.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='transcription_jobs' AND column_name='lease_token'",
          )
        ).rows,
      ).toHaveLength(1);
      expect(await runMigrations(db)).toEqual([]);
    } finally {
      await client.close();
    }
  });
  it('also accepts the committed SQL through the standard Drizzle migrator', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    try {
      await migrate(db, { migrationsFolder: migrationsDir });
      expect(
        (
          await client.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='transcription_jobs' AND column_name='lease_token'",
          )
        ).rows,
      ).toHaveLength(1);
      await migrate(db, { migrationsFolder: migrationsDir });
      expect((await client.query('SELECT * FROM drizzle.__drizzle_migrations')).rows).toHaveLength(
        17,
      );
    } finally {
      await client.close();
    }
  });
  it('rolls back lease DDL when its journal insert fails, then retries safely', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as Database;
    try {
      await db.execute(
        sql.raw(
          'CREATE TABLE __migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());',
        ),
      );
      await client.exec(
        "CREATE FUNCTION migration_crash() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name = '0016_transcription_leases.sql' THEN RAISE EXCEPTION 'injected journal crash'; END IF; RETURN NEW; END $$; CREATE TRIGGER migration_crash BEFORE INSERT ON __migrations FOR EACH ROW EXECUTE FUNCTION migration_crash();",
      );
      await expect(runMigrations(db)).rejects.toThrow();
      expect(
        (
          await client.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='transcription_jobs' AND column_name='lease_token'",
          )
        ).rows,
      ).toEqual([]);
      expect((await client.query('SELECT * FROM __migrations')).rows).toHaveLength(16);
      await client.exec(
        'DROP TRIGGER migration_crash ON __migrations; DROP FUNCTION migration_crash();',
      );
      expect(await runMigrations(db)).toEqual(['0016_transcription_leases.sql']);
    } finally {
      await client.close();
    }
  });
});
