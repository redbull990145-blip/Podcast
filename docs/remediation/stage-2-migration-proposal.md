# Stage 2 migration proposal: leases and quota settlement

**Status: approved for local Stage 2 implementation and isolated tests only.** The schema, executable migration and journal are prepared locally. Exact standalone forward/rollback SQL has been tested only in disposable, in-memory databases. No persistent or production database has been migrated. See [Stage 2 implementation report](stage-2.md) for final evidence and remaining risks.

Requested approval covers this exact schema design, local schema/code implementation and isolated migration/regression tests. Applying it to a persistent database, pushing or deploying remains a separate approval gate.

## Purpose and coordinated behavior

F21–F24 need durable attempt ownership and settlement state. Existing `episode_id` uniqueness prevents duplicate job rows but does not make the preceding quota charge atomic. Existing `heartbeat_at` cannot distinguish an old worker from a replacement, and `quota_day` alone cannot tell whether a failed job was already refunded.

Proposed fields on `public.transcription_jobs`:

- `lease_token uuid`: fresh application-generated UUID on every worker claim/reclaim. Every heartbeat, failure, final transcript save and completion compares the token under a row lock; a stale worker cannot write or refund a replacement attempt.
- `funding_source text`: immutable `byok` or `operator` for new admissions, with `legacy` only for pre-cutover rows.
- `quota_state text`: `unmetered` for BYOK, `reserved` for operator quota, or `refunded` after a terminal refund. `legacy` preserves uncertainty for old rows. Successful completion saves the transcript and removes the job atomically; the successful charge remains in existing `ai_usage`.

No new service, extension, credential or paid infrastructure is required. Existing `user_id`, `quota_day`, attempts and queue index remain.

## Exact proposed forward SQL

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

The SQL deliberately does not infer or change old quota counts, ownership, status, transcripts or refund history. It contains no `IF NOT EXISTS`: unexpected partial state should fail instead of silently accepting a different definition. Migration replay is handled by the migration journal after approval.

## Implementation contract after approval

Admission locks the episode and rechecks a ready transcript/job inside the same transaction as reserving quota and inserting/reviving the winning job. An active existing job is joined without charging the second account. Quota denial rolls back admission. New rows explicitly provide funding and quota state; defaults do not classify new work.

Claim/reclaim rotates the lease token and increments attempts atomically. A periodic heartbeat runs during downloads, provider calls and waits. Losing the lease aborts further external work where cancellation is possible. Already-started provider work can still incur cost; database fencing prevents it from saving or settling somebody else's attempt.

Final save locks/checks the current lease and atomically writes the ready transcript and removes the job. Failure and abandonment settlement change `reserved` to `refunded` and decrement the original account/day counter in one transaction, at most once. BYOK never refunds operator quota. Transient retries keep the same reservation and admitted source; terminal failure refunds once. A new user-requested admission after terminal failure is a new reservation. A stale final attempt is settled rather than left `running` indefinitely.

Use a consistent episode-then-job lock order for admission and transcript mutations to avoid reciprocal waits. Existing quota counter updates remain atomic. Account identity comes from the server session, matching Stage 1's request-intent check.

## Legacy rows and cutover risks

Existing rows receive `legacy`/`legacy` and a null lease. **The new worker will not automatically process, revive or refund legacy rows.** Their old failure path could have refunded quota already, and current rows have no durable receipt proving otherwise. Guessing would risk double refunds or repeated charges.

A production cutover therefore needs a separately approved inventory/classification plan for any legacy jobs, with workers and job admission quiesced. The local test suite will prove that ambiguous rows are held intact and cannot silently spend/refund quota. This proposal does not authorize live classification, cancellation, deletion or counter corrections.

Other risks:

- `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock by default; these checks can scan the table and briefly block readers/writers. Lock/statement timeouts abort instead of waiting indefinitely. Production duration has not been measured. See [PostgreSQL 17 ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html) and [locking modes](https://www.postgresql.org/docs/17/explicit-locking.html).
- Old and new workers must not overlap during cutover: old workers ignore the token and settlement fields. A rolling mixed-version release would defeat fencing.
- New code must fail closed if the migration is missing. Startup should check the schema capability before enabling job admission or workers.
- Persisting no provider key in a job preserves the current encrypted-key design. A removed/unreadable BYOK key fails safely; it does not switch to operator funding.
- New constraints do not replace server validation and do not establish production RLS correctness. No RLS/policy changes are proposed.

## Exact rollback SQL and strategy

Before rollback, disable new job admission and stop all workers. If new reservations were admitted, first settle them with the new code or preserve/export their lease and settlement records under a separately approved production procedure. Dropping settlement state while jobs are outstanding can cause double charges/refunds when old code resumes.

For a local test database or a production cutover rolled back **before new admissions**, reverse the schema with:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.transcription_jobs
  DROP CONSTRAINT transcription_jobs_running_lease_check,
  DROP CONSTRAINT transcription_jobs_funding_quota_check,
  DROP CONSTRAINT transcription_jobs_quota_state_check,
  DROP CONSTRAINT transcription_jobs_funding_source_check,
  DROP COLUMN quota_state,
  DROP COLUMN funding_source,
  DROP COLUMN lease_token;

COMMIT;
```

Keep admission/workers stopped until compatible old code is restored. Do not use `CASCADE`. The rollback leaves original rows/counters/transcripts intact but destroys the newly added metadata. After new work begins, a forward repair or retaining the additive schema is safer than blind schema removal. Production backup/export and code rollback remain separately authorized operations.

## Tests required before Stage 2 can be reported complete

The implementation report records the completed tests and their verification limits. This list preserves the original acceptance criteria.

1. Apply the exact forward SQL to fresh and populated legacy fixtures in isolated PGlite; check defaults, constraints, row preservation and transactional failure. Apply exact rollback and verify original rows/columns/counters.
2. Concurrent admissions by two accounts for the same episode produce one job and one winning-account reservation. Joining an active job never charges the joining account. A ready transcript discovered under lock is not charged again.
3. Quota zero/exhaustion produces no new job, transcript mutation or positive charge. Inject errors between reservation, job insertion and transcript state changes; verify complete rollback.
4. Reclaim with a different token; the old token cannot heartbeat, save, complete, fail or refund the current attempt. Test an A–B–A sequence so ownership is not inferred from user/episode alone.
5. An abandoned third attempt becomes terminal and refunds its reservation exactly once. Race two settlers and verify one decrement. Deleted accounts never refund another account.
6. Transient retries retain one charge, source and original UTC day across midnight. Terminal retry/new admission uses the newly admitted account without inheriting the previous reservation.
7. Inject crashes before/after final save and refund transaction boundaries; after restart, there is neither a ready transcript with an unsettled failed write nor a double refund.
8. Heartbeats continue during provider/download waits; shutdown wakes the idle loop and cancels current work. Verify bounded provider deadlines and cancellation without a real external credential.
9. Legacy rows stay quarantined unchanged and never undergo inferred refunds/admission. Schema-missing startup disables admission/worker processing.
10. Retain Stage 1 BYOK and account-isolation regressions, then run the full API/database suites, typecheck, build and Git diff checks. PGlite tests establish local logic; live Postgres contention and production recovery remain separately gated verification.
