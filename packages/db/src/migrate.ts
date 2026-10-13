/**
 * Applying migrations.
 *
 * The same committed SQL runs everywhere — local dev, tests, production. There
 * is no "push the schema" path that only developers use, because a schema that
 * was never expressed as a migration is a schema nobody can reproduce.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Database } from './client.ts';

/** Absolute path to the committed migration SQL. */
export const migrationsDir = join(import.meta.dirname, '../migrations');

/**
 * Drizzle's `execute` returns whatever the underlying driver returns:
 * postgres-js hands back a bare array, PGlite and node-postgres wrap rows in
 * an object. Normalising here keeps the migrator driver-agnostic.
 */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

/**
 * Apply any migration that has not run yet.
 *
 * Deliberately simple: filenames sort lexicographically, applied ones are
 * recorded in a table, and each is wrapped so a partial failure does not leave
 * half a migration behind. Drizzle ships its own migrator, but it differs per
 * driver, and this needs to behave identically on postgres-js and PGlite.
 */
export async function runMigrations(db: Database): Promise<string[]> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "__migrations" (
      "name" text PRIMARY KEY,
      "applied_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  // Every other table gets row-level security from a migration, because every
  // other table is declared in the Drizzle schema. This one is created here,
  // so it has to be locked down here. Supabase exposes the whole `public`
  // schema over PostgREST, and a table with RLS off is world-readable to
  // anyone holding the anon key — which is a public value by design.
  //
  // No policies accompany this: RLS with an empty policy set denies everyone.
  // The owner role the API connects as bypasses RLS, so this costs us nothing
  // and is a no-op when re-run against a database that already has it.
  await db.execute(sql`ALTER TABLE "__migrations" ENABLE ROW LEVEL SECURITY`);

  const applied = await db.execute(sql`SELECT name FROM "__migrations"`);
  const done = new Set(rowsOf<{ name: string }>(applied).map((row) => row.name));

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const ran: string[] = [];

  for (const file of files) {
    if (done.has(file)) continue;

    const text = readFileSync(join(migrationsDir, file), 'utf8');

    // Drizzle owns the transaction and its pooled connection, including the
    // migration journal write. SQL files contain statements without BEGIN/COMMIT.
    const statements = text.split('--> statement-breakpoint');
    await db.transaction(async (tx) => {
      for (const statement of statements) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) await tx.execute(sql.raw(trimmed));
      }
      await tx.execute(sql`INSERT INTO "__migrations" (name) VALUES (${file})`);
    });
    ran.push(file);
  }

  return ran;
}
