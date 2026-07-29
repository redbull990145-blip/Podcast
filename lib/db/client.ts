import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Drizzle client for server-side use only.
 *
 * The connection is created lazily on first query, not at import time. Next
 * imports every route module while collecting page data during a build, so an
 * eager connection would make `next build` require live database credentials —
 * breaking CI and any build that runs without production secrets.
 *
 * The pool is capped at one connection with a short idle timeout: serverless
 * functions get a fresh module scope per cold start, and many short-lived
 * instances will otherwise exhaust Supabase's free-tier connection ceiling.
 */

type Database = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  // Reused across hot reloads in dev so we do not leak connections.
  var __podcastSql: ReturnType<typeof postgres> | undefined;
  var __podcastDb: Database | undefined;
}

function createDb(): Database {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  const sql =
    globalThis.__podcastSql ??
    postgres(connectionString, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // required when connecting through Supabase's transaction pooler
    });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__podcastSql = sql;
  }

  return drizzle(sql, { schema });
}

function getDb(): Database {
  if (!globalThis.__podcastDb) {
    globalThis.__podcastDb = createDb();
  }
  return globalThis.__podcastDb;
}

/**
 * Behaves exactly like a Drizzle instance, but defers connecting until the
 * first property access. Methods are bound so `db.insert(...)` keeps its
 * receiver.
 */
export const db = new Proxy({} as Database, {
  get(_target, property, _receiver) {
    const instance = getDb();
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };
