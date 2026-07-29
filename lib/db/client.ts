import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Drizzle client for server-side use only.
 *
 * Serverless functions get a fresh module scope per cold start, so the
 * connection pool is kept to 1 and idle connections are reaped quickly —
 * Supabase's free tier has a modest connection ceiling and many short-lived
 * function instances will otherwise exhaust it.
 */

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
}

declare global {
  // Reused across hot reloads in dev so we do not leak connections.
  var __podcastSql: ReturnType<typeof postgres> | undefined;
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

export const db = drizzle(sql, { schema });
export { schema };
