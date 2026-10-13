# Phase 2.5 database, queue, transcript and alignment verification

Local evidence captured on 2026-10-12. This is isolated verification, not production verification. No persistent pre-existing database, live service, production credential, push or deployment was used. No schema SQL was changed in this pass.

## Changes and confirmed defects

| Defect | Evidence before fix | Minimal change | Verification |
| --- | --- | --- | --- |
| A delayed publisher transcript fetch could overwrite an admitted/generated transcript, including a successful charged transcript or a job later refunded | Held publisher-fetch regression tests failed against the prior route implementation | `routes/transcripts.ts` locks episode then job, rereads current transcript, refuses any job/generated/current replacement, and returns the actual current row. Generated failures no longer trigger publisher TTL refresh. Publisher replacement clears its obsolete alignment. | Eight route tests pass, including delayed success/failure, admitted work, legacy jobs, newer publisher data, metadata reset and late audio measurement |
| Concurrent alignment requests could reserve quota twice in one process | Two service concurrency regressions failed before the change | `ai/align/service.ts` publishes its shared admission promise before awaiting quota; cleanup checks that exact promise | Three service tests pass: pending admission sharing, failed admission cleanup, BYOK failure without operator refund |
| Alignment and late audio measurement could publish metadata to replacement feed data | Existing source/revision guards did not identify the observed feed data | `ai/align/run.ts` saves alignment with a conditional update on source/status/fetchedAt/revision/segments. The route uses an analogous guard for late measurement. Publication failure returns the existing failed outcome rather than attaching a stale map. | Six alignment publication regressions plus route measurement regression pass |
| `claimNext` inspected only the first 32 candidates, so 32 locked old episode rows starved later unlocked work | Native PostgreSQL 17 regression returned `null` while eight later queued jobs existed | `ai/queue.ts` pages by `(created_at, episode_id)` until it claims or exhausts candidates. Cursor uses server timestamp text to preserve microseconds, with UUID tie breaking. | Native test with 32 held locks and all timestamps equal at microsecond precision passes |
| Queue mutations could wait indefinitely on locks/statements after cancellation | Native timeout primitives proved server cancellation and transaction rollback; the existing worker grace bounded the caller but did not impose database deadlines | Queue admission, claim/recovery, heartbeat, completion and failure transactions issue `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '30s'` on their actual transaction connection | Actual heartbeat lock cancellation, actual completion statement cancellation and blocked shutdown settlement tests pass; rollback and subsequent recovery are asserted |
| Admission logging could report a reservation that later rolled back | Failure injected after quota reservation, before job admission commit | Admission emits only committed episode/attempt/funding/quota-state metadata, after the transaction resolves | Native trigger-induced admission failure emits no log or counter/transcript; committed admission emits exactly the safe payload once; duplicate admission emits no second reservation |

Source and focused test files in this scope:

- `apps/api/src/routes/transcripts.ts`, `apps/api/src/routes/transcripts.test.ts`
- `apps/api/src/ai/align/service.ts`, `apps/api/src/ai/align/service.test.ts`
- `apps/api/src/ai/align/run.ts`, `apps/api/src/ai/align/publication.test.ts`
- `apps/api/src/ai/queue.ts`
- `apps/api/src/test/native/queue.native.ts`, `apps/api/vitest.native.config.ts`
- `scripts/test-native-postgres.mjs`

Existing Stage 1/2 edits and the parent's concurrent metadata/lifecycle improvements remain intact. No new npm dependency was added.

## Disposable PostgreSQL runtime and safety boundary

The user separately approved downloading a portable PostgreSQL 17 runtime and testing disposable databases. The current official EDB binary page was checked at implementation time: https://www.enterprisedb.com/download-postgresql-binaries. The selected Windows x64 PostgreSQL 17.11 archive was https://sbp.enterprisedb.com/getfile.jsp?fileid=1260616.

- Archive size: 381,531,864 bytes.
- SHA-256: `80379B2C04D51C30225532E0AE04509899141E9957ED096FE749D7FD9DF8F82F` (recorded locally; this is not an independently published vendor checksum).
- Portable runtime: `node_modules/.cache/phase25/pg17-ed439efc510c488fa5426f4282e50615/minimal/pgsql/bin`.
- No system installation, service registration, PATH changes or paid infrastructure.

The runner accepts only a portable binary directory under the ignored Phase 2.5 cache, rejects any existing database URL input, checks PostgreSQL major 17, creates a unique fresh cluster, binds it to `127.0.0.1`, and creates a random synthetic database. It strips ambient database environment variables from child processes, verifies the owned server PID/port before connecting, checks the server's actual `data_directory`, and records ownership. The test suite validates the marker, owning processes, actual server version and exact cluster directory before migration or data operations. The runner stops only its exact owned cluster in `finally`, retaining the stopped ignored evidence. No arbitrary server/database is accepted by the harness.

Reproduction, after the same explicit runtime approval:

```powershell
node scripts/test-native-postgres.mjs 'D:\Claude Code Projects\Podcast\node_modules\.cache\phase25\pg17-ed439efc510c488fa5426f4282e50615\minimal\pgsql\bin'
```

The dedicated native config and explicit native test filter prevent these tests from joining ordinary API test runs. Synthetic provider behavior is used for the worker cancellation test; it executes the real worker, queue failure settlement and native SQL, and never calls a transcription provider or downloads audio.

## Native result: 20 tests passed

Final result: **1 file, 20/20 tests passed**, PostgreSQL **17.11**. Test duration 54.16 seconds; Vitest duration 59.42 seconds. Cluster `native-a0036d86870c4dbab9cec292f0b22dec` was stopped successfully. The server log ends with `database system is shut down`; no PostgreSQL process remained at the post-run check.

Evidence retained in the ignored cache:

- `node_modules/.cache/phase25/native-a0036d86870c4dbab9cec292f0b22dec/results.json`
- `node_modules/.cache/phase25/native-a0036d86870c4dbab9cec292f0b22dec/postgres.log`
- `node_modules/.cache/phase25/native-a0036d86870c4dbab9cec292f0b22dec/owner.json`

These are actual independent postgres-js connections with deliberate lock barriers, not concurrent promises serialized by PGlite:

1. Fifteen duplicate admission/account races behind an episode lock: one reservation, original owner/day retained.
2. Two different episodes contending for allowance one behind the quota-row lock: only one admission.
3. Ready feed transcript committed while admission waited: no job or charge.
4. Simultaneous workers distribute unlocked work while the oldest episode is locked.
5. Thirty-two locked older candidates do not starve later work; exact microsecond timestamp ties advance correctly.
6. Transient retry retains original account/day; later admission by another account cannot steal it; terminal settlement ignores falsified caller account/day.
7. Removed and unreadable BYOK keys fail closed; terminal settlement never charges/refunds operator quota.
8. Injected admission failure rolls counter/job/transcript back and emits no success log; committed logging exposes no secret/capability.
9. Actual heartbeat mutation times out on a row lock in **5,110 ms**, leaves progress/lease unchanged, then works after unlock; local setting restores to zero.
10. Actual completion pauses job deletion after transcript upsert, times out in **30,161 ms**, restores the processing transcript and running reserved job, retains charge, then succeeds after removing the fault; local setting restores to zero.
11. Injected transcript-settlement failure rolls quota refund and failed job state back together, then one later terminal settlement refunds once.
12. Actual worker cancellation reaches a blocked real SQL settlement; `stop()` returns in **5,145 ms**, logs failure, preserves reservation/lease, and a replacement lease recovers and refunds once. The obsolete shutdown lease cannot settle the replacement.
13. Fifteen simultaneous first playback writes behind episode locks preserve the further position at a tied timestamp; later stale device writes cannot undo a newer session or completion; different account rows remain separate.
14. A-B-A attempt sequence and lease expiry: both stale workers cannot heartbeat/save/fail/refund; the third saves successfully with the original charge intact.
15. Fifteen simultaneous completion-versus-terminal-failure races produce either ready plus retained charge or failed plus refund, never mixed state; duplicate terminal settlers refund once.
16. Exhausted crash recovery versus manual admission: reservation count matches the surviving queued/failed outcome and stale exhausted settlement loses ownership.
17. Fifteen account-deletion versus terminal-settlement races never credit a different account and leave the current FK deletion semantics explicit.
18. Native statement timeout primitive rolls a preceding insertion back and resets session settings.
19. Deterministic two-connection reverse-lock deadlock produces `40P01` for one transaction and rolls its partial writes back.
20. Exact reviewed forward/rollback SQL on a populated old-schema database: preserves legacy rows/counters, checks funding/day/lease constraints, demonstrates rollback provenance loss for active reservations, tests forced pre-commit failure rollback and the exact five-second DDL lock timeout.

The main fresh test database also ran every committed migration and passed the production schema-capability checker against native PostgreSQL's constraint formatting.

Earlier results are not substituted for the final green run. An initial harness run had fixture errors (date cast and native microsecond timestamp comparison) and an unintended ordinary-test include; that run was cancelled, its owned cluster stopped, and its totals are not counted. The next focused native run had 10/12 pass: starvation was a confirmed code failure, while the migration comparison failure was the remaining fixture representation problem. Both were corrected before the final 20/20 run. One focused PGlite run under simultaneous build/runtime extraction load exceeded its setup deadline and skipped eight route tests; a subsequent isolated repeat passed all 17 focused tests.

## Focused local checks and PGlite distinction

- Before scoped route/alignment edits: existing parser/map/detection/anchor baseline **4 files / 95 tests passed**.
- Negative reproductions before fixes: publisher route five tests and alignment service two tests failed; BYOK service regression passed.
- Final focused repeat: **3 files / 17 tests passed**, 24.31 seconds (eight route, three alignment admission, six alignment publication).
- API TypeScript check passed after the new queue/native code.
- ESLint passed for all scoped source/tests/config/runner files.
- Runner `node --check` and `git diff --check` passed. Parent owns complete integrated suites/builds and their final results.

PGlite tests establish application state transitions, guards, invariants and failure handling in an isolated embedded database. The installed runtime identifies itself as PostgreSQL **18.3 / PGlite 0.5.5**, not native PostgreSQL 17. It does not prove independent-session locking, deadlock behavior or server cancellation deadlines. A separate memory-only probe showed `SET LOCAL statement_timeout = '100ms'` did not cancel `pg_sleep(0.2)` in PGlite; the transaction committed. Only the explicitly identified native PostgreSQL cases above prove those semantics.

## Exact existing migration and rollback

Authoritative unchanged files: `docs/remediation/stage-2-forward.sql` and `docs/remediation/stage-2-rollback.sql`. The forward migration acquires a brief exclusive table lock, adds three ownership/funding columns and four constraints, and defaults old rows to quarantined legacy state. It does not infer historical quota charges, modify counters, reassign owners or revive legacy jobs.

Forward:

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

Rollback:

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

Native tests used these exact files, without applying them to an existing persistent database. Legacy original row JSON and quota count were identical after forward then rollback. Forced pre-commit SQL error and DDL lock timeout left none of the new columns installed after rollback.

Rollback is **not** a safe operational recovery while new jobs/reservations are active: it removes lease/funding/settlement provenance while keeping old rows/counters. New code then fails closed on missing capabilities. Separately approved operational rollback must stop admission/workers, drain or explicitly reconcile every live reservation, preserve an ownership snapshot, and align migration-journal and code state before dropping columns. This report does not authorize that action.

## Remaining limits and decisions

- Account deletion still invokes existing job-owner `ON DELETE SET NULL` and quota-row cascade. This avoids refunding another account, but erases original quota ownership/provenance. The native race cases do not prove every possible FK deadlock schedule; a synthetic native reverse-lock test proves deadlock rollback/reporting only. Durable deletion audit or reservation tombstones require an explicit architecture/schema decision.
- Queue timeouts apply once a transaction connection is acquired, per SQL statement. They do not bound connection-pool acquisition, schema-capability reads, candidate-list reads, entire transaction duration or provider latency. Worker grace bounds returned shutdown, and unsuccessful settlement leaves a recoverable lease rather than claiming success.
- Alignment deduplication remains per process, as before. Independent API instances can still reserve/run alignment twice; a durable alignment queue/reservation design needs separate architectural approval.
- Alignment publication and late audio measurement now carry a server-rendered UTC timestamp string with all six fractional digits, rather than reconstructing the database timestamp from a JavaScript Date. Conditional writes compare the parameter as `timestamptz`. Historical unchanged rows therefore retain their exact version, and sub-millisecond replacement rows reject stale publication.
- Publisher replacement recognition compares the exact server timestamp and the observed source/status/revision/segments under its existing episode/job locks. This also rejects content changes that reuse a normal millisecond publisher timestamp. No persistent version column or schema change was added; an indistinguishable replacement with identical checked fields has the same snapshot semantics.
- Quota-across-midnight verification preserves an explicitly old quota day and falsified caller day while using real SQL; it does not change the computer/server clock. Real provider success, live deployment shutdown, production pool settings, live data/schema compatibility and production workload latency remain unverified.
- Playback equal timestamp/position/completion ties retain the existing incoming-record rule; tests prove tied timestamps with different positions, newer sessions and completion behavior. No new total ordering of otherwise equal device records was introduced.
- Legacy jobs remain quarantined. No historical counter reconciliation is inferred. Persistent migration/production approval remains separate.

Next steps: review this scoped result together with the parent's integrated regression/type/lint/build gates, decide any needed account-deletion/cluster-wide-alignment architecture, and obtain separate operational approval before any persistent migration or deployment.

## Timestamp precision follow-up, 2026-10-13

Changes are confined to `apps/api/src/ai/align/run.ts`, `apps/api/src/routes/transcripts.ts`, their publication/route tests, and the existing native test file. The exact timestamp accompanies initial reads, locked rereads, and inserted publisher rows returned for late measurement; it is not added to API response fields. No migration, dependency, funding policy, or production configuration changed in this follow-up.

Two regressions reproduced before the fix: an unchanged historical timestamp ending in `.000123` rejected a valid alignment, while a held publisher fetch overwrote a replacement ending in `.000456` within the same JavaScript millisecond. The first combined negative run had a publisher-suite startup hook timeout and nine skipped cases; these skips provide no functional evidence. A separate negative publisher run with an explicitly longer test-startup allowance reproduced the overwrite. The final focused PGlite run passed **2 files / 20 tests**, including six added precision/same-timestamp cases. The longer allowance affects only the command used for isolated startup, not application deadlines.

Native follow-up fixture/scheduling failures are recorded separately from application defects. One added late-measurement fixture initially had only one cue; the established `isTimed` rule correctly skips measurement for such a transcript. It now contains two distinct cue starts. The existing exhausted-crash race test assumed recovery finished in one simultaneous poll and that replacement work remained queued. Actual native schedules can claim an admitted replacement immediately, or have both `SKIP LOCKED` claimers skip an episode briefly locked by admission. The test now verifies exact account/lease/quota ownership for an admitted replacement, or verifies the unchanged exhausted reservation followed by an explicit unlocked recovery poll, terminal refund, and stale-lease rejection.

The first follow-up runner's synchronous `pg_ctl` wait exceeded its shutdown deadline. Independent checks found its exact server PID and loopback listener absent and `pg_ctl` reported no server running. The parent changed only the runner's shutdown wait to asynchronous process handling so PostgreSQL output continues draining. Subsequent runs recorded a clean shutdown and removal of `postmaster.pid`.

A later full run passed all 23 test assertions but its asynchronous shutdown still exceeded the original 30-second wait; the log recorded a 25.819-second filesystem checkpoint plus shutdown overhead. That run is not counted as a successful overall runner invocation, although independent PID/listener/status checks confirmed the owned cluster was no longer running. The test runner now uses a bounded 60-second shutdown wait, without changing application worker deadlines.

The final fresh PostgreSQL **17.11** run passed **1 file / 23 tests**, no skipped tests, in **64.84 seconds** (test execution 58.60 seconds), and the complete runner exited **0**. The three added native cases verify a held publisher fetch rejecting a sub-millisecond replacement, unchanged historical microsecond timestamps accepting alignment while replacement timestamps reject it, and a new publisher row accepting its late audio measurement using the returned exact version. The remaining cases retain the original native admission/settlement/crash/timeout/migration/rollback evidence.

Final isolated evidence: `node_modules/.cache/phase25/native-6707d8898c6646928663b8b41ad90e10/results.json`, `owner.json`, and `postgres.log`. The cluster was bound to `127.0.0.1:58673` with synthetic data. Shutdown output confirms it stopped; its log records `database system is shut down`, and `postmaster.pid` is absent. Independent checks also confirm its server PID 15224 and listener 58673 are absent, and the exact owned-directory `pg_ctl status` reports no server running. No existing database or production service was used, and no evidence files were deleted.
