import type { Database } from '@cue/db';
import { sql } from 'drizzle-orm';
import { AppError } from '../errors.ts';

// Canonical PostgreSQL constraint definitions for the approved migration.
const constraints: Record<string, string> = {
  transcription_jobs_funding_source_check:
    "CHECK ((funding_source = ANY (ARRAY['legacy'::text, 'byok'::text, 'operator'::text])))",
  transcription_jobs_quota_state_check:
    "CHECK ((quota_state = ANY (ARRAY['legacy'::text, 'unmetered'::text, 'reserved'::text, 'refunded'::text])))",
  transcription_jobs_funding_quota_check:
    "CHECK ((((funding_source = 'legacy'::text) AND (quota_state = 'legacy'::text)) OR ((funding_source = 'byok'::text) AND (quota_state = 'unmetered'::text) AND (quota_day IS NULL)) OR ((funding_source = 'operator'::text) AND (quota_state = ANY (ARRAY['reserved'::text, 'refunded'::text])) AND (quota_day IS NOT NULL))))",
  transcription_jobs_running_lease_check:
    "CHECK (((funding_source = 'legacy'::text) OR (status <> 'running'::text) OR (lease_token IS NOT NULL)))",
};
const normalized = (value: string) => value.replace(/\s+/g, ' ').replace(/"/g, '').trim();
function rows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] })?.rows ?? [])) as T[];
}

/** Read-only capability check: never migrate or attempt repairs at runtime. */
export async function assertJobSchema(db: Database): Promise<void> {
  const incompatible = () =>
    new AppError(
      'upstream_unavailable',
      'Transcription is unavailable until its approved database migration is installed and verified.',
    );
  try {
    const columns = rows<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      await db.execute(
        sql.raw(
          "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transcription_jobs' AND column_name IN ('lease_token', 'funding_source', 'quota_state')",
        ),
      ),
    );
    if (
      columns.length !== 3 ||
      !columns.some(
        (c) => c.column_name === 'lease_token' && c.data_type === 'uuid' && c.is_nullable === 'YES',
      ) ||
      !['funding_source', 'quota_state'].every((name) =>
        columns.some(
          (c) =>
            c.column_name === name &&
            c.data_type === 'text' &&
            c.is_nullable === 'NO' &&
            c.column_default === "'legacy'::text",
        ),
      )
    )
      throw incompatible();
    const checks = rows<{
      conname: string;
      convalidated: boolean;
      definition: string;
    }>(
      await db.execute(
        sql.raw(
          "SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'public.transcription_jobs'::regclass AND contype = 'c'",
        ),
      ),
    );
    if (
      !Object.entries(constraints).every(([name, definition]) =>
        checks.some(
          (c) =>
            c.conname === name &&
            c.convalidated &&
            normalized(c.definition) === normalized(definition),
        ),
      )
    )
      throw incompatible();
  } catch {
    throw incompatible();
  }
}
