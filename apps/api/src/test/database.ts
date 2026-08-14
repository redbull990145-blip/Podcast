/**
 * A real Postgres for tests, in-process.
 *
 * PGlite is Postgres compiled to WASM, so these tests exercise the actual SQL
 * that runs in production — `ON CONFLICT` semantics, the keyset predicate,
 * index behaviour, constraint violations. A mocked database would prove the
 * code calls Drizzle, which is not the part that breaks.
 *
 * Dev-only dependency: it never ships.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@cue/db';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dirname, '../../../../packages/db/migrations');

export type TestDatabase = ReturnType<typeof drizzle<typeof schema>> & {
  /** Empty every table without re-running migrations. */
  $reset: () => Promise<void>;
  $close: () => Promise<void>;
};

/**
 * Tables to clear between tests, children first.
 *
 * Booting a fresh PGlite per test costs ~5 seconds; truncating costs
 * milliseconds. With a suite that runs on every save, that difference decides
 * whether the tests get run at all.
 */
const TABLES = ['podcast_categories', 'episodes', 'categories', 'podcasts'] as const;

/**
 * Apply the committed migration SQL rather than pushing the schema.
 *
 * That means the tests verify the same DDL the production database gets — if a
 * migration is missing an index, these tests are running without it too, which
 * is the honest signal.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) await client.exec(trimmed);
    }
  }

  return Object.assign(db, {
    $reset: async () => {
      await client.exec(
        `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`,
      );
    },
    $close: async () => {
      await client.close();
    },
  }) as TestDatabase;
}
