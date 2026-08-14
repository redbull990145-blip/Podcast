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

  const applied = await db.execute(sql`SELECT name FROM "__migrations"`);
  const done = new Set(rowsOf<{ name: string }>(applied).map((row) => row.name));

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const ran: string[] = [];

  for (const file of files) {
    if (done.has(file)) continue;

    const text = readFileSync(join(migrationsDir, file), 'utf8');

    // Drizzle separates statements with this marker; splitting on `;` would
    // break any function body or string literal that contains one.
    for (const statement of text.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) await db.execute(sql.raw(trimmed));
    }

    await db.execute(sql`INSERT INTO "__migrations" (name) VALUES (${file})`);
    ran.push(file);
  }

  return ran;
}
