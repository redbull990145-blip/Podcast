# Stage 2: durable jobs, quota settlement and atomic progress

Date: 2026-10-12. **Locally implemented and tested; not production-verified.** Stage 1 remains accepted as local verification only. Stage 3, Stage 4 and UI/UX redesign have not begun.

## Inspected schema and call sites

Before implementation, the committed migrations, Drizzle schema, transcription routes, admission, claiming, retries, heartbeats, final publication, failures, quota helpers, ai_usage, API/standalone worker entry points and shutdown hooks were traced. All production transcription mutations now enter queue.ts; startTranscription delegates admission, and runJob carries the complete claimed lease. Alignment and non-durable chat calls retain their separate quota helpers; transcription no longer calls their unguarded refund helper.

The actual pre-migration job table uses episode_id as its primary key, nullable user_id and quota_day, text status, attempts, heartbeat_at, progress and creation fields. ai_usage has a unique user/day counter. No contradictory pre-existing lease or settlement fields were found. Existing rows cannot prove historical charges/refunds, so they receive legacy/legacy and remain quarantined.

**Existing account-deletion exception:** user_id uses ON DELETE SET NULL, and ai_usage uses ON DELETE CASCADE. Deleting an account therefore erases its quota counter and clears its job owner. The approved additive migration preserves these foreign keys. The deletion regression proves that no replacement account receives a refund. The historical deleted-account ID cannot be preserved by this three-column design; retaining that provenance would require a separate schema decision and migration approval. No extra ownership column or guessed history was added.

## Changes and evidence

| Finding | Implemented behavior | Local regression evidence |
| --- | --- | --- |
| F09 | Progress locks the existing episode, then reads/reconciles/writes progress in one transaction. The episode lock covers simultaneous first-row creation. Existing reconciliation rules, account identity and HTTP/UI shape remain. | Two request-order variants for concurrent first writes and a completion/progress race, plus all existing progress/auth tests. |
| F21 | Expired final attempts acquire a fresh recovery token and atomically become failed with one terminal settlement. Manual admission after settled terminal failure starts a new reservation. | Crashes/reclaims through all three attempts, simultaneous exhausted-job recovery, and manual retry. |
| F22 | Each claim/reclaim receives a random UUID token. Heartbeat, publication/completion, failure and refund check current ownership; episode/job locks protect compound writes. Claim paths use SKIP LOCKED and recheck candidates under lock. Periodic heartbeats run every 30 seconds during downloads/provider work/waits. | Worker A–B–A leases, account A–B–A admissions, late success/failure/heartbeat, held downloads, replacement cancellation and final-save rollback. |
| F23 | Ready/duplicate checks, quota reservation, job creation/revival and processing transcript state commit together. Conditional quota upserts never increment a denied reservation; zero allowance writes no counter. | Concurrent same-episode accounts/duplicates, concurrent different episodes with allowance one, zero allowance and injected admission crash. |
| F24 / F04 | Funding is explicit and retained for an admitted job. Transient retries retain the original account/day reservation and attempt count. Terminal failure refunds once inside the same fenced transaction; successful publication deletes the job while retaining its charge. BYOK stays unmetered. | Simultaneous settlers, complete-versus-fail, lost success responses, retries across midnight, changed/forged caller ownership, removed/unreadable BYOK, absent encryption configuration and missing original counter. |
| F25 | Provider request deadlines cover headers and body: chat/stream 90 seconds, transcription 180 seconds per attempt. Whole chat operation is capped at 6 minutes; a transcription upload at 10 minutes plus its caller-provided rate-wait budget. External episode work has a 2-hour cancellation deadline; database waits still require a responsive database. Caller cancellation wakes retry/backoff/rate waits. | Stalled headers/body, timer cleanup, pre-aborted no-send, cancellation in waits/backoff, repeated slow 429s across the whole-operation deadline, and job deadline settlement. |
| F26 | Idle/error/schema-check waits wake on stop. Active work receives cancellation; worker stop allows up to 30 seconds for settlement, then logs that an unfinished lease needs recovery. Failed startup schema checks retry with backoff while refusing claims. | Idle stop, error backoff, active cancellation/settlement, incompatible schema, schema recovery and cancellation-ignoring settlement grace expiry. |
| F31, needed by this migration | The custom local migration runner executes each migration and its journal insert on one transaction connection. The API test harness exercises this runner on memory-only databases. | Journal-insert failure rolls back lease DDL; retry applies once. Both the custom runner and standard Drizzle migrator apply/idempotently replay the committed files on isolated PGlite. |

A read-only schema capability check validates the three new column definitions/defaults and four validated check constraints before job reads/mutations. Missing or weakened schema fails closed; it never repairs or migrates a runtime PostgreSQL database.

A missing non-deleted account/day counter causes settlement to roll back and surface an error. It is not converted into a pretend refund or credit to a different counter. Such inconsistent data requires a separately approved recovery investigation.

## Exact migration and rollback

Standalone review/test files: [forward SQL](stage-2-forward.sql) and [rollback SQL](stage-2-rollback.sql). They match the approved proposal's SQL blocks exactly.

The executable [0016_transcription_leases.sql](../../packages/db/migrations/0016_transcription_leases.sql) contains exactly the same SET LOCAL statements and ALTER TABLE body, separated with Drizzle statement breakpoints. BEGIN/COMMIT belong to the runner's transaction; embedding them would conflict with the standard Drizzle migrator. A regression verifies this equivalence. The generated snapshot differs from 0015 only in snapshot identity, the three job columns and four checks. Existing migration files, table relationships, RLS and indexes are preserved.

Forward, executed only in disposable in-memory tests:

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

Rollback, executed only in disposable in-memory tests:

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

### Migration risks and rollback limits

- ALTER TABLE takes an ACCESS EXCLUSIVE lock; constraint validation can scan existing rows. The scripts use a 5-second lock timeout and 30-second statement timeout. Production lock duration and workload impact are unmeasured. [PostgreSQL locking documentation](https://www.postgresql.org/docs/17/explicit-locking.html).
- Legacy queued/running/failed rows keep original fields and counters. They are not claimed, revived, reassigned or refunded. A separately approved inventory/recovery procedure is needed; old processing transcript rows can remain processing until that decision.
- Old workers ignore lease tokens. Quiesce admission and every old worker before any approved cutover; mixed old/new versions would defeat fencing.
- Stop admission/workers before rollback. The exact rollback preserves original rows/counters but removes the new metadata. Once new reservations exist, blind rollback is unsafe: settle/export them under an approved procedure, or retain the additive schema/repair forward.
- Rollback SQL deliberately does not edit either migration journal or use CASCADE. A future rollback after a journaled migration needs a separately reviewed code/journal reconciliation plan before reapplication; otherwise the journal can say applied while the columns are absent. The runtime capability check then refuses work.
- Schema capability definitions were measured on isolated PGlite. Canonical constraint formatting and permissions must still be verified on native PostgreSQL 17. Equivalent-but-differently-formatted definitions can fail closed.
- Current source matches the approved pre-migration design, and fixtures apply committed migrations 0000–0015 before testing 0016. This stage did not re-read or modify a persistent schema.
- The existing local PGlite application boot path automatically applies pending migrations. Do not start it against an existing persistent development directory without separate migration approval. These tests used newly created memory-only databases.

## Validation

All final workspace suites pass, retaining the Stage 1 security/account-isolation regressions:

| Workspace | Files | Passing tests |
| --- | ---: | ---: |
| API | 37 | 612 |
| Database | 3 | 28 |
| Core | 15 | 252 |
| API client | 1 | 21 |
| Web | 5 | 21 |
| Mobile | 3 | 6 |
| Design | 3 | 355 |
| i18n | 1 | 55 |
| Motion | 4 | 58 |
| Validation | 2 | 41 |
| **Total** | **74** | **1,449** |

Tests ran from individual workspace directories with Vitest 4.1.11, native configuration loading, disabled caches/filesystem module caching, one thread worker and no file parallelism. The complete API and database suites were run sequentially to avoid competing PGlite startup workloads. A focused seven-file run also passed 90 tests after the final queue-option correction; those tests are included in the totals, not additional distinct tests.

Database evidence includes seven exact migration/rollback tests and three runner integration tests: fresh and populated legacy databases, approved defaults/checks, rejected invalid states, unchanged legacy jobs/counters, DDL rollback after an injected error, incompatible pre-existing columns, dependent-view rollback failure without CASCADE, idempotent runner replay and rollback/retry after a journal failure.

Additional final gates:

- TypeScript passes for all 11 workspaces with a typecheck script, using noEmit and incremental false; API was rechecked after the final worker edit.
- ESLint passes for apps/api, apps/web, apps/mobile and packages.
- API production build passes, producing API and standalone-worker bundles.
- Next 16.3.8 production build passes with NEXT_PUBLIC_API_URL set to a loopback address, INTERNAL_API_TOKEN empty and telemetry disabled. No API service was started. Next's generated type-reference lines were restored to their exact baseline contents.
- git diff --check passes; scoped source/migration/new-file diffs were reviewed, including snapshot comparison.
- No newly skipped test remains in the final suites.

Earlier failures were not counted as successful verification: the first heavily overlapping API/database/typecheck run had an API 30-second setup timeout (39 skipped tests) and four database 10-second timeouts. The isolated database config now uses bounded 30-second test/hook timeouts and sequential files. Subsequent complete runs passed. TypeScript also caught the Drizzle true-only SKIP LOCKED option, a test promise-union annotation and an exported AbortSignal declaration type; these were corrected and checks rerun. A default-bundled Vitest invocation failed to spawn its config bundler in the sandbox; native config loading succeeded. No test assertion was weakened to conceal a failing lease/quota result.

**What PGlite proves:** actual PostgreSQL/WASM SQL execution, constraints, transactions, rollback, lifecycle/account/day invariants and simultaneous JavaScript callers through its serialized backend. It does **not** prove multi-connection native PostgreSQL MVCC, lock contention, SKIP LOCKED distribution, deadlock behavior, account-deletion races across connections, pooler behavior, native cancellation or migration lock timing.

No existing native PostgreSQL concurrency harness, PostgreSQL executables or Docker runtime was available on PATH. Native PostgreSQL concurrency was not run. No live Groq call, production database test, real SIGTERM/process-kill rehearsal, native mobile/device test, browser-installed-worker test or production verification was performed. Mobile has no production build script; an Expo/EAS release and OpenNext/Workers adapter build were not run.

Database operations themselves do not have a new universal query deadline. A stalled renewal/settlement can outlive the episode cancellation deadline. Worker stop has the tested 30-second grace and logs unfinished recovery; it does not pretend that a blocked transaction settled. Already-started external work may incur provider usage after replacement; fencing protects database results and quota settlement, not a provider's billing ledger.

Build/test warnings retained: Next's existing middleware-convention deprecation and Node's existing mobile package module-type warning. No redesign or middleware migration was made.

## Dependencies

No dependencies, package manifests or lockfile entries were added/changed in Stage 2. The Stage 1 patched versions remain.

The public npm bulk advisory endpoint and registry metadata were rechecked at **2026-10-12 14:20:30 UTC**, against **1,208 package names** in the current lockfile: **six affected packages / seven advisories remain**.

| Installed affected package | Current registry/compatibility result |
| --- | --- |
| esbuild 0.18.20 | Moderate [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99); latest 0.28.2. The affected @esbuild-kit/core-utils parent pins ~0.18.20 through Drizzle tooling. |
| braces 3.0.3 | High [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm); latest remains 3.0.3, no published patched release. |
| decode-uri-component 0.2.2 | Moderate [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr); latest 0.5.0 is outside query-string's ^0.2.2 range; advisory includes versions through 0.4.2. |
| image-size 1.2.1 | Two high advisories: [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr). Latest patched 2.0.4 is outside Metro's ^1.0.2 range. |
| node-forge 1.4.0 | High [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv); latest remains 1.4.0, no published patched release. Expo parents use ^1.3.3. |
| uuid 7.0.3 | Moderate [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq); patched 11.1.1+ is outside xcode's ^7.0.3 range; latest 14.0.3. |

No compatible repair was forced across a parent API/major-version contract. This is an advisory inventory, not a production exploitability claim or a zero-advisory result. F36 remains partially open.

## Changed files and preservation

These are Stage 2 changes relative to the recorded pre-Stage-2 working tree, not the entire dirty Git diff:

| Group | Files |
| --- | --- |
| Admission/funding/lease execution | apps/api/src/ai/access.ts; queue.ts; queue-schema.ts (new); transcribe.ts; worker.ts |
| Provider deadlines | apps/api/src/ai/deadline.ts (new); groq.ts |
| Atomic progress | apps/api/src/playback/progress.ts (new); apps/api/src/routes/playback.ts |
| Worker entry-point documentation | apps/api/src/worker-main.ts |
| API regressions | apps/api/src/ai/access.test.ts; groq.test.ts; queue.test.ts; queue-settlement.test.ts (new); deadline.test.ts (new); transcribe-lifecycle.test.ts (new); worker.test.ts (new); apps/api/src/routes/playback.test.ts |
| Isolated API database harness | apps/api/src/test/database.ts |
| Database schema/types/runner | packages/db/src/schema/transcript.ts; packages/db/src/client.ts; packages/db/src/index.ts; packages/db/src/migrate.ts |
| Migration artifacts | packages/db/migrations/0016_transcription_leases.sql (new); packages/db/migrations/meta/0016_snapshot.json (new); packages/db/migrations/meta/_journal.json |
| Database regressions/config | packages/db/src/transcription-migration.test.ts (new); packages/db/src/migration-runner.test.ts (new); packages/db/vitest.config.ts |
| Report/exact scripts | docs/remediation/stage-2.md (new); stage-2-forward.sql (new); stage-2-rollback.sql (new); stage-2-migration-proposal.md (approval/status wording only; SQL blocks unchanged) |

The baseline recorded **483 existing tracked/untracked paths**. The final comparison found **no newly missing path**, **464 unchanged path states/bytes**, and **19 intentionally edited existing files** listed above. Fourteen new Stage 2 files include this report. Existing deletions remain as they were. No reset, clean, stash, Git staging, commit or checkout was used. Existing Stage 1/user edits were retained; the overall Git diff still includes their UI work. No web/mobile UI source was changed during Stage 2.

HEAD remains 3b8409be69ffed8c4376788c421b32986258e8af. No push, deployment, production setting/service/data change, persistent database migration, secret access/rotation or paid infrastructure action occurred.

## Proposed next steps — work stops here

1. Review this report and the account-deletion provenance limitation. If historical ownership after deletion is required, approve preparation of an additional exact migration proposal before any further schema implementation.
2. Arrange an isolated multi-connection PostgreSQL 17 rehearsal before release, covering admission/settlement races, SKIP LOCKED, A–B–A fencing, account deletion, faults/shutdown and both migration runners. It can use throwaway credentials without production access.
3. Approve a legacy inventory and cutover/rollback procedure separately before any persistent migration. Keep old workers quiesced; do not infer old counters or settlement.
4. Review Stage 2 before authorizing Stage 3. Playback reporting/player races, mobile verification/session/offline behavior and transcript UI/functionality remain that stage's work.
5. Keep Stage 4 separate. Existing Render TRUST_PROXY_HOPS=1 lacks the verified allowlist required by Stage 1 and intentionally fails validation. CORS for the Vercel backup, Cloudflare headers, CI credential references, Render health-path configuration and serving-version proof still need their own review/approval. They were not modified or freshly live-tested in this stage.

No Stage 3/4 action or UI/UX redesign is authorized by this report.
