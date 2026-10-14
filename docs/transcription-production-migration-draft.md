# Transcription schema repair draft

Status: **approved migration 0016 applied and verified on 2026-10-14.** The user confirmed the production project and approved only this migration after backup and cutover checks. The earlier investigation and exact scope are retained below; execution evidence follows at the end.

## Confirmed schema gap

The Render API now starts, but its transcription worker refuses to process jobs because `assertJobSchema` requires schema capabilities introduced by `0016_transcription_leases.sql`.

The Supabase project was identified by matching the project reference from the local `DATABASE_URL` to the connected project inventory. Only the hostname/reference were extracted; credentials were neither printed nor included here. The user subsequently confirmed that this project is the Render production database and approved the exact additive migration below after backup and cutover verification.

Read-only metadata queries on that matching project found:

| Required capability | Observed state |
| --- | --- |
| Nullable `lease_token uuid` | Missing |
| Non-null `funding_source text DEFAULT 'legacy'` | Missing |
| Non-null `quota_state text DEFAULT 'legacy'` | Missing |
| Four funding/quota/lease CHECK constraints | Missing |
| Primary key on `episode_id` | Present |
| Existing queue index on `(status, created_at)` | Present |
| `transcripts.alignment jsonb` from migration 0015 | Present |
| RLS on `transcription_jobs` | Enabled; no public policies |

The Drizzle migration journal matches the committed SQL files **0000 through 0015**, comparing both LF and CRLF file bytes; **0016 is absent**. The separate `public.__migrations` table is empty. Do not use that empty journal to replay the entire migration chain against an already populated schema. The production procedure should retain Drizzle's existing migration history.

Only schema metadata and migration identities were read. No user rows or job inventory were queried, so outstanding legacy-job counts and backup availability remain unverified.

## Exact proposed change

Apply only the existing reviewed [0016 migration](../packages/db/migrations/0016_transcription_leases.sql) through the existing Drizzle migration runner after target/backup/cutover approval. The standalone transaction equivalent is already tracked at [stage-2-forward.sql](remediation/stage-2-forward.sql):

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.transcription_jobs
  ADD COLUMN lease_token uuid,
  ADD COLUMN funding_source text NOT NULL DEFAULT 'legacy',
  ADD COLUMN quota_state text NOT NULL DEFAULT 'legacy',
  ADD CONSTRAINT transcription_jobs_funding_source_check
    CHECK (funding_source IN ('legacy', 'byok', 'operator')),
  ADD CONSTRAINT transcription_jobs_quota_state_check
    CHECK (quota_state IN ('legacy', 'unmetered', 'reserved', 'refunded')),
  ADD CONSTRAINT transcription_jobs_funding_quota_check
    CHECK (
      (funding_source = 'legacy' AND quota_state = 'legacy')
      OR (funding_source = 'byok' AND quota_state = 'unmetered'
          AND quota_day IS NULL)
      OR (funding_source = 'operator' AND quota_state IN ('reserved', 'refunded')
          AND quota_day IS NOT NULL)
    ),
  ADD CONSTRAINT transcription_jobs_running_lease_check
    CHECK (funding_source = 'legacy' OR status <> 'running'
           OR lease_token IS NOT NULL);

COMMIT;
```

The change adds metadata and constraints; it does not delete jobs, transcripts, users or quota records. It adds no indexes, policies, extensions or credentials. Existing jobs receive `legacy` values and remain quarantined intact. The new worker does not automatically process, retry or refund those ambiguous jobs.

## Cutover and approval scope

1. Confirm the exact Render database project and a recoverable backup. Obtain approval for the additive SQL above and the coordinated API/worker cutover.
2. Verify only migration 0016 is pending in Drizzle history; refresh schema metadata immediately before execution to reject partial/manual changes.
3. Ensure no old worker or old admission process remains running. The repaired Render deployment replaced the old API, but all independently configured worker instances must be accounted for. New code currently blocks admissions and processing while this schema is absent.
4. Apply only 0016 through the existing migration runner, using a private process environment for the database URL. The SQL's lock/statement deadlines abort rather than wait indefinitely. Do not include seed data or use schema push/reset.
5. Confirm the three column definitions, all four validated constraints, unchanged primary key/index/RLS state, and journal entry 0016. Recheck the worker logs, new admission behavior and `/health/ready` independently.
6. Leave legacy rows intact. Any inventory, classification, cancellation, deletion, retries or historical quota changes need a separate concrete plan; this draft authorizes none of them.

`ALTER TABLE` takes an exclusive table lock and constraint validation can scan existing rows. The production table size and lock duration were not measured during this metadata-only investigation. A lock timeout is a failed migration requiring investigation, not a reason to remove the timeout.

After new jobs begin, retain the additive schema when reverting application code unless a separately reviewed settlement/export procedure permits removing the lease/quota state. [The existing rollback SQL](remediation/stage-2-rollback.sql) removes that metadata and is unsuitable for blindly undoing a release with outstanding new reservations.

## Documentation checked

The [Supabase changelog](https://supabase.com/changelog) and [current migration workflow](https://supabase.com/docs/guides/local-development/cli-workflows) were checked before querying. The recent [PostgreSQL minor-release changes](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) concern extensions/operators rather than missing application columns. The [CBC cipher deprecation](https://supabase.com/changelog/cbc-tls-ciphers-deprecated) does not affect direct Postgres/pooler connections. Neither explains this application migration gap.

## Approved execution and verification

Before the change, a PostgreSQL custom-format recovery archive captured `public.transcription_jobs`, `drizzle.__drizzle_migrations` and `public.__migrations`, including their schema and data. It was created outside the repository with directory access restricted to the current Windows user and SYSTEM, then preserved in a permanent private backup folder. The temporary original was retained. No dump contents, credentials or private backup paths are included in this public report.

The **8,626-byte** archive passed `pg_restore --list` checks for all three tables and table-data entries; all archive sections decoded successfully. Its preserved copy matched SHA-256 `6cbfcd075b82a896353fc798820ad496e1e81444c909bbb1b0845feb051fa013`. This is a scoped recovery archive, not a provider-wide backup or a claim that a production restore was performed.

Render inventory showed one Podcast API service with one instance and no separate Podcast worker service. The previously running August deployment was explicitly `deactivated`, and the repaired API revision was `live`. The current worker/admission code was blocked by the missing schema. Fresh read-only preflight checks reconfirmed 16 Drizzle journal entries ending at 0015 and zero partially installed new columns/constraints. A private direct connection independently verified that the committed journal contained **only 0016 pending**.

The existing **Drizzle migrate** runner applied only the approved migration and exited **0**, reporting success at **2026-10-14 15:39:04 UTC** (21:09:04 IST). The database connection remained in the child process's private environment. No schema push/reset, seed execution, legacy-job classification, job-status update or quota correction was performed.

Read-only verification ran the actual API `assertJobSchema` implementation against the production database and passed its exact column/default/nullability and validated-constraint checks. Drizzle history now contains **17 entries**, ending at 0016. The original primary key, queue index and enabled RLS were preserved.

Render logged **“transcription worker started”** at **15:41:17 UTC**, and no application error was returned for the checked interval after migration. Public `/health` and `/health/ready` both returned **200**, identifying `72b1226` with `dirty:false`; readiness measured **2 ms** database latency. These checks establish schema compatibility and worker startup. No paid transcription request or historical legacy-job change was initiated.
