/**
 * The database connection.
 *
 * One pool per process, created lazily. Supabase's pooler is what we connect
 * through in production, so the client-side pool stays small — a large local
 * pool multiplied by however many API instances is how you exhaust a
 * connection limit that a free tier has very little of.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

export type Database = ReturnType<typeof createPostgresDatabase>;

export type DatabaseOptions = {
  connectionString: string;
  /**
   * Keep this low. The API is IO-bound on upstream feeds far more than on
   * Postgres, and Supabase's free tier gives limited connections.
   */
  maxConnections?: number;
};

/**
 * Open a database from a connection string.
 *
 * A `pglite:` URL runs Postgres in-process, backed by a directory on disk.
 * That exists so the whole stack starts with no accounts and no Docker — the
 * cost of "sign up for a database before the app will boot" is paid by every
 * person who ever clones this, and it is the most common reason a local setup
 * is abandoned before it runs once.
 *
 * It is a development convenience and nothing more: `pglite:` is rejected in
 * production, where the source of truth is a real Postgres.
 */
export async function createDatabase(options: DatabaseOptions): Promise<Database> {
  if (options.connectionString.startsWith('pglite:')) {
    return createPgliteDatabase(options.connectionString);
  }
  return createPostgresDatabase(options);
}

/**
 * Imported dynamically so PGlite — a dev dependency weighing tens of megabytes
 * of WASM — is never loaded by a production process that will not use it.
 */
async function createPgliteDatabase(connectionString: string): Promise<Database> {
  const path = connectionString.replace(/^pglite:(\/\/)?/, '');

  const [{ PGlite }, { drizzle: drizzlePglite }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
  ]);

  // `pglite://memory` is a throwaway database that never touches disk — what
  // tests want, so they start from a known-empty state and leave nothing
  // behind. Anything else is a directory to persist into.
  const client = path === '' || path === 'memory' ? new PGlite() : new PGlite(path);

  return drizzlePglite(client, { schema }) as unknown as Database;
}

function createPostgresDatabase({ connectionString, maxConnections = 5 }: DatabaseOptions) {
  const sql = postgres(connectionString, {
    max: maxConnections,
    // A query that hasn't answered in 15s is not going to.
    idle_timeout: 20,
    connect_timeout: 15,
    // Supabase requires TLS; `prepare: false` is required through its
    // transaction-mode pooler, which does not support prepared statements.
    prepare: false,
  });

  return drizzle(sql, { schema });
}

export { schema };
