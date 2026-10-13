# Phase 2.5 + Phase 3A reliability and security report

Verification period: 2026-10-12–13. **Local implementation and verification only. Production is not verified or approved for release.**

## Outcome

Completed the safe local hardening scope across authentication, private browser caching, transcription ownership/accounting, transcript publication, playback, mobile identity, downloads, and release configuration. Confirmed additional defects independently rather than accepting earlier reports as proof. Native PostgreSQL and installed Chromium provided evidence beyond the previous mocks and PGlite tests.

The user separately approved the portable PostgreSQL 17 download/disposable cluster and the mobile policy for persisting a last server-verified identity bound to an exact token and expiry. No new persistent database schema was designed. The existing reviewed Stage 2 migration and rollback remain unchanged.

Final quality-gate results are recorded below after the last precision and expiry changes. Remaining advisories, device verification, hosting credentials/settings, and production migration/release decisions remain explicit gates.

## Baseline and preservation

- Branch: `main`; HEAD: `3b8409be69ffed8c4376788c421b32986258e8af`; nothing staged.
- Existing working tree contained 100 tracked modifications/deletions plus substantial untracked work from earlier stages and UI work. Those changes were inspected and retained.
- A 497-path hash snapshot, original status, and complete tracked diff were saved under ignored `node_modules/.cache/phase25/` before implementation. The two pre-existing `landing-preview` deletions remain pre-existing deletions.
- The lockfile, package manifests, reviewed SQL, migration journal/snapshot, and unrelated design/layout changes are compared with this snapshot in the final preservation review. An unchanged hash proves byte preservation; deliberately edited files were reviewed against the starting diff, rather than claiming their bytes stayed unchanged.
- Previous generated OpenNext output was copied into a unique ignored backup before the adapter rebuilt it. The original `next-env.d.ts` bytes were saved before Next rewrote generated type references. Test databases, browser profiles, and bundle outputs were disposable; stopped evidence is retained in the ignored cache.

Independent baseline checks: API **37 files / 612 tests**; database **3 / 28**; core **15 / 252**; web **5 / 21**; mobile **3 / 6**. Design **3 / 355**, i18n **1 / 55**, motion **4 / 58**, and validation **2 / 41** also passed. The API-client early repeat already included a new test (**22**); its previous Stage 2 report listed **21**, so it is not presented as an untouched new baseline. All **11** workspace TypeScript checks passed before implementation. Earlier production-build claims were historical; new builds were run in this phase.

## Architecture and independent review

The Next web app and Expo mobile app share `@cue/api-client`, playback/download/sync logic in `@cue/core`, and domain contracts. Fastify uses Better Auth and Drizzle, with postgres-js for native PostgreSQL and PGlite for isolated tests/local development. Transcription admission, lease ownership, transcript publication, and quota settlement share episode/job/quota lock order. The worker and API have separate build entrypoints. Publisher feeds, artwork, and audio use guarded external fetching. Browser private caches are account scoped; native progress storage records ownership separately from the delivery queue.

Three coordinated specialists investigated security/hosting, database/queue/migrations, and playback/mobile. Follow-up specialists addressed timestamp fencing, final gates and an independent final review. That review also reproduced cache-storage failures and an unbounded mobile resume lookup. The parent reviewed their recommendations, implemented browser/transcript/parser fixes, ran installed-browser checks and integrated gates, and audited preservation. Editing ownership was separated; no specialist was authorized to deploy or access existing databases.

Detailed evidence: [security/hosting review](phase-25-security.md), [database/queue review](phase-25-database.md), [Stage 1 report](stage-1.md), [Stage 2 report](stage-2.md).

## Original findings F01–F38

“Verified locally” describes the stated test environment only; it does not establish live service or installed-device behavior.

| Finding | Status and local evidence | Remaining boundary |
|---|---|---|
| F01 private service-worker cache isolation | Hardened and tested in VM and an installed Chromium worker: account-intent header, generation fencing, purge failure closed, neutral navigation fallback, old-worker upgrade, cold-start denial, offline expiry. Invalid/missing expiry metadata cannot authorize private replay. | Browser revocation while fully offline cannot be discovered before reconnect; known expiry is enforced. New `/me` expiry metadata must ship with this worker. |
| F02 mobile progress crosses accounts | Account-owned outbox, captured request identity, generation fencing and A–B–A tests retained/expanded. | Native filesystem and credentials are mocked; no handset verification. |
| F03 bodyless/cookie CSRF | Retained Origin guard; expanded POST/PATCH/PUT/DELETE matrix for invalid/trusted Origin, cookie plus fake bearer, bodyless/alternate content types and preflight. | Cookie-free bearer-shaped public test endpoints prove origin policy, not authentication; real bearer auth has separate tests. |
| F04 BYOK falls back to operator | Funding source admitted once; removed/unreadable keys fail closed. Native and lifecycle tests retain operator counters unchanged. | No real provider key or paid request used. |
| F05 alternate verification throttle | Shared durable limiter path retained and tested before the mail handler. | Real Redis persistence/restart and live proxy configuration remain unverified; absent Redis disables limiting and requires release review. |
| F06 mobile verification/signup | Nullable token handling and verification use the existing form flow; token persistence tests pass. | Minimal functional form correction only; installed-device/email delivery unverified. |
| F07 native logout leaves session | Captured departing token revocation retained; local state clears immediately. Added real Better Auth tests rejecting old signed web session-cache cookies after logout/expiry. | Offline logout cannot revoke a remote session until a successful server request; local credential removal is verified with mocks. |
| F08 periodic/final playback writes | Episode-owned periodic and forced final observations; bounded browser retry buffer, mobile snapshots and outbox tests. | Browser retry buffer is memory only; abrupt process termination can lose undelivered data. |
| F09 atomic progress reconciliation | Existing atomic SQL retained; native multi-connection lock-barrier tests verify first-write races, out-of-order observations, completion and account separation. | Hosted pooler/multi-device production behavior unverified. |
| F10 player races | Latest command generation wins; old native/web callbacks and metadata seeks fenced; transcript taps use atomic `playAt`. | Real audio engines/OS interruptions unverified. |
| F11 queued item replays | Core queue deduplicates and consumes a manually played item once; regressions pass. | No production claim. |
| F12 sleep depends on progress events | Independent expiry timer pauses without a position event and flushes progress; fake-clock tests pass. | OS suspension may delay JavaScript timers; native background behavior needs a device. |
| F13 stale AI status cached | AI polling, transcript and auth paths stay live; VM/browser routing coverage retained. | Actual deployed worker upgrade still required. |
| F14 generated mobile transcript hidden | Queries no longer depend on a publisher transcript URL; processing refresh and seek contract tests pass. | Screen behavior checked by types/query tests, not an emulator. |
| F15 late transcript listeners/visibility | Bind to the actual asynchronously mounted element; cleanup timers/listeners. Installed Chromium fixture exercises actual hooks. | Fixture is not an end-to-end real episode/provider test. |
| F16 nested speed focus trap | Portal owns Tab/Shift+Tab/Escape; outer trap defers to inner dialog. Browser hook fixture verifies wrapping/restoration/backdrop. | Existing visual presentation retained. |
| F17 mobile offline startup identity | Approved exact-token/server-expiry SecureStore policy; restart, expiry, missing metadata, concurrent persistence and replacement tests. Startup verification has a 15-second cancellation deadline. | Fully offline revocation is unknowable until reconnect; device clock/native storage are residual assumptions. |
| F18 offline local resume lost | Account-owned last observation remains after successful delivery and reconciles with server progress. | Mocked local storage/audio verification. |
| F19 deleted download loses publisher URL | Canonical episode URL retained and local source resolved when loading; source tests pass. | Real file disappearance/native engine behavior unverified. |
| F20 cancel/resave download races | Distinct attempt paths, ownership checks, bounded artwork cleanup and stale callback/finalizer tests. | No Android filesystem/device execution. |
| F21 exhausted crash orphan | Native and PGlite recovery tests settle exhausted attempts once and quarantine legacy jobs. | Production schema/cutover unapproved. |
| F22 unfenced leases | Current token required for heartbeat/save/fail/refund; native A–B–A and completion/failure races pass. | Remote provider cancellation is best effort; late results cannot publish through a stale lease. |
| F23 duplicate quota admissions | Episode/job/quota admission transaction verified with native duplicate and exact-limit contention. | No live counters touched. |
| F24 retry/refund accounting | Original account/day retained across retries; terminal refund at most once; native rollback/crash/deletion races. | Existing account deletion destroys historical provenance; separate durable accounting design may be justified. |
| F25 provider deadlines | Existing chat/transcription/download deadlines retained; new DNS/feed cancellation and cleanup tests; native queue statement/lock deadlines. | Pool acquisition, capability/candidate reads, readiness and unrelated queries lack a universal deadline. OS DNS work can finish after caller cancellation. |
| F26 shutdown | Idle/error waits wake; active work cancels with settlement grace. Real blocked SQL failure preserves a recoverable lease/reservation. | Process owner must terminate after grace when uncancellable acquisition/work remains. |
| F27 SSRF/DNS rebinding | Pinned lookup retained; IPv4/mapped IPv4/native IPv6 matrix, redirects, DNS deadlines and cleanup hardened. | Socket/TLS host preservation is partly code inspection; no production exploit/network test. Rare special-purpose/transition IPv6 publishers are rejected conservatively. |
| F28 artwork body fallback | Existing body failure/fallback regression retained in final API suite. | CDN/device/browser artwork failures unverified live. |
| F29 invalid transcript entities | Valid Unicode retained; malformed scalar entities replaced safely; unsafe/invalid times skipped; parser regressions pass. | Publisher network parsing uses synthetic fixtures. |
| F30 default production auth secret | Production configuration rejects missing/default signing secrets; persistent PGlite startup now requires explicit migration opt-in before opening a directory. | Production secrets neither read nor changed. |
| F31 partial migrations | Existing transactional runner retained; isolated PGlite and native migration rollback/lock tests. | Persistent application requires separate exact-migration approval. |
| F32 Vercel backup CORS | Local exact-origin configuration/tests reviewed. | Original live finding is historical; authorized production origin settings and cookie/preflight validation remain required. |
| F33 Cloudflare headers | CSP request/response nonce fix, asset header generation and local Next production browser proof. Adapter gate reported below. | Actual Cloudflare document and ASSETS headers unverified; local Next proof is not Cloudflare serving proof. |
| F34 Cloudflare CI credential | Existing secret reference retained; missing-input preflight diagnoses absent names without printing values. | Credential availability cannot be fixed locally; no workflow dispatched. |
| F35 Render health path | Source already declares `/health`; liveness/readiness distinction checked. | Live independently managed service setting unverified; readiness `select 1` does not prove job capacity or schema readiness. |
| F36 dependency advisories | Fresh public registry/advisory review: six packages/seven advisories remain; no compatible safe update established. | Parent range/major migrations or upstream fixes required; see matrix below. |
| F37 release provenance | Build-time validated full SHA and dirty/unknown state; API artifact and Next response checks. | Commit alone does not identify uncommitted source; no live serving revision verified. |
| F38 persistent Cloudflare cache | Deliberate no-op cache remains documented; no evidence justified new infrastructure. | R2/cache architecture/billing decision remains deferred and unapproved. |

## Additional confirmed defects

High-impact fixes include revoked signed-cookie replay, attacker-supplied request CSP controlling Next's nonce extraction, publisher fetches overwriting generated processing/ready transcripts, stale alignment/measurement publication, and private cached navigation carrying account hydration. Alignment admission now installs the shared promise before reserving quota, preventing duplicate same-process work. Generated replacements reset obsolete publisher alignment and audio metadata. Transcript version fences retain native microseconds and reject stale source/status/revision/segment replacements.

Final review reproduced three CacheStorage failure paths: public cache opening/matching could reject a healthy catalogue response, and private cache opening could turn a usable response into an offline error. Optional cache work now preserves the live response; private storage failure disables offline private replay. Separate regressions enforce known session expiry while fully offline and reject malformed/missing expiry metadata. Anonymous and unavailable `/me` responses also receive `private, no-store` with credential-aware `Vary`; both missing-header regressions failed before the fix.

Mobile resume now skips remote progress when connectivity is known offline. Online lookup has a 15-second promise deadline and transport cancellation; even a noncooperative fetch cannot indefinitely block a downloaded episode. Tests retain local progress and prove late results, newer play intent and A–B–A account changes cannot replay stale audio.

An actual built-API startup check exposed packaging failures beyond a successful compiler exit. The build externalized only direct API dependencies, bundling third-party modules reached through workspace source, including PGlite's asset-dependent code. Bundled migration paths also lacked packaged SQL. API/worker builds now retain third-party runtime imports, bundle workspace TypeScript, and copy all 17 unchanged SQL files beside the artifacts. Only the compiled migration path is relocated; migrator source and schema are unchanged. Three artifact regressions and a three-check built-process smoke test now pass. The API runtime smoke used an empty in-memory PGlite database and no credentials.

Native PostgreSQL reproduced first-page queue starvation: 32 locked episodes prevented claiming later work. Keyset pages now advance using full server timestamp precision plus episode ID. Queue transactions use 5-second lock and 30-second statement timeouts on their own connection, with rollback proof. These limits are per statement inside the transaction, not a universal wall-clock transaction/pool deadline. Admission logs follow commit; worker logs carry episode/attempt/funding correlation without lease tokens, keys or account emails.

Resource protections remain explicit: API body limit, guarded RSS/transcript body cap and redirects, episode/upload limits, sequential provider work, bounded progress coalescing/retries, bounded probes and download concurrency. No speculative global queue limit, new retention job, paid observability dependency or catalogue cache was added.

## Native PostgreSQL and migration assessment

Approved portable Windows PostgreSQL **17.11**, official EDB archive, 381,531,864 bytes; locally recorded SHA-256 `80379B2C04D51C30225532E0AE04509899141E9957ED096FE749D7FD9DF8F82F`. This is a local checksum, not independently authenticated vendor checksum verification. Runtime stayed under ignored test storage; no service/system/PATH installation.

The harness only accepts that local portable runtime. It creates UUID-owned clusters/databases, binds to `127.0.0.1`, strips ambient database environment variables, verifies PID/port/version/data directory, and stops its exact cluster in `finally`. It uses independent postgres-js connections and synthetic accounts. Native results and final shutdown evidence are listed in the validation section and scoped database report.

The unchanged exact SQL is [forward migration](stage-2-forward.sql) and [rollback](stage-2-rollback.sql); [proposal and operational risks](stage-2-migration-proposal.md). Both SQL files use explicit transactions and local DDL lock/statement limits. Native tests apply the committed migrations to a fresh database and reviewed SQL to populated prior schema, check constraints/legacy preservation, force rollback before commit, and test blocked DDL. PGlite **0.5.5 / PostgreSQL 18.3 WASM** is reported separately: it verifies SQL/constraints/transactions but did not reproduce native timeout semantics or independent connection contention.

Rollback is safe before new-model admissions, after stopping writers, reconciling the migration journal and approving the exact operation. After admission, dropping funding/quota/lease columns loses accounting provenance and does not refund or undo reservations. Native tests demonstrate this loss; successful SQL execution is not proof of a safe business rollback. Prefer a separately reviewed forward repair after admissions. Legacy jobs remain quarantined; old counters are not inferred, rewritten, or reassigned.

Existing account-delete FKs can clear job ownership and delete `ai_usage`. Native deletion races cannot credit a different account, but a deleted original owner/counter cannot be reconstructed or safely refunded. A durable accounting ledger/tombstone policy is a recommendation requiring separate schema/retention approval; it was not implemented.

Alignment deduplication remains per API process. Independent API instances can still reserve and run alignment twice; a durable alignment queue/reservation design requires separate architectural approval. The publication fences prevent stale results from overwriting a changed transcript, but do not establish cluster-wide alignment admission.

## Dependency and hosting residuals

Public advisory bulk check at **2026-10-12T15:32:07.870Z**, 1,208 package names: **six affected packages / seven advisories**. Versions and parent ranges were rechecked; no dependency or lockfile update in this phase. Full advisory URLs, dependency paths and exposure assessment are in the [security report](phase-25-security.md).

| Installed package | Exposure/path | Safe compatible fix established? |
|---|---|---|
| esbuild 0.18.20 | Old Drizzle `@esbuild-kit` tooling; vulnerable development serve path | No; fix >=0.25 outside pinned `~0.18.20` parent range. |
| braces 3.0.3 | micromatch/glob tooling inputs | No patched published release at check time. |
| decode-uri-component 0.2.2 | query-string/mobile dependency graph; exact device reachability unverified | Patched 0.5.0 outside parent's range. |
| image-size 1.2.1 | Metro asset/bundle parsing; two advisories | Patched 2.0.4 requires parent compatibility/major review. |
| node-forge 1.4.0 | Expo certificate/signing tooling | No patched published release at check time. |
| uuid 7.0.3 | Xcode project tooling | Fix >=11.1.1 outside parent's `^7.0.3`. |

Runtime reachability was not invented from dependency presence. Untrusted glob/asset/certificate inputs should not be fed into vulnerable tooling pending maintained parent fixes. No `audit fix --force`, new package manager, lockfile deletion, unsupported override or installation occurred. Advisory status may change after the stated timestamp.

Render preparation removes an unverified hop-count trust setting and declares an explicit proxy-address input rather than inventing addresses. Actual proxy topology/allowlist must be verified before deployment; direct socket addresses remain the safe default. CI permissions and missing-input diagnostics are local changes only. The internal renderer token, Cloudflare account/token, backup CORS and actual live health settings still require operator verification/approval. Existing cache/image bindings were not provisioned or changed. Middleware naming remains deprecated because the current adapter requires the edge path; adapter Windows/support warnings are reported honestly below.

## Final tests and builds

Installed runtime: Node **24.19.0**, Next **16.3.8**, Expo SDK **57**, PGlite **0.5.5**, native PostgreSQL **17.11**, Chromium **151.0.7922.34**. Tests used installed dependencies; no package installation/update was added in this phase.

| Ordinary suite | Files | Tests | Result |
|---|---:|---:|---|
| API | 43 | 673 | Passed; includes Stage 1 security/isolation and Stage 2 lifecycle/settlement regressions. |
| Core | 15 | 259 | Passed. |
| Web | 7 | 40 | Passed; includes 17 service-worker VM tests. |
| Mobile | 10 | 36 | Passed; native modules/files/storage mocked. |
| API client | 1 | 24 | Passed. |
| Database | 3 | 28 | Passed; isolated PGlite. |
| Design | 3 | 355 | Passed. |
| i18n | 1 | 55 | Passed. |
| Motion | 4 | 58 | Passed. |
| Validation | 2 | 41 | Passed. |
| **Total** | **89** | **1,569** | **No failures or skipped tests in these final runs.** |

These totals use each JSON report's file results, not Vitest's nested describe-suite count. Final reports/logs are retained under ignored `node_modules/.cache/phase25/final-*.json` and `.log`. Unchanged suites were not repeated unnecessarily; affected suites were repeated after subsequent edits.

Native PostgreSQL: **1 file / 23 tests**, no skips, complete runner exit **0**. Independent connections test admission/claim/refund/completion/account/deletion/progress races, statement and lock timeouts, exact timestamp publication, forward/rollback SQL, legacy preservation and DDL rollback. Final cluster `native-6707d8898c6646928663b8b41ad90e10` stopped: shutdown log, absent PID 15224/listener 58673, absent `postmaster.pid`, and exact-directory `pg_ctl status`. PGlite is separate evidence and does not establish native contention/timeouts.

Installed Chromium: **8** service-worker checks, **5** actual-hook DOM checks, and **4** built Next checks. These cover old-worker upgrade, account switches, in-flight logout, expiry, cold-worker denial, neutral navigation, transcript mounting/touch/wheel cleanup, nested dialog focus/Escape, fresh document nonces, overridden attacker CSP, executable script nonces, worker headers and artifact provenance. Fixtures are synthetic loopback services, not production accounts, publisher workloads or handset tests.

API/worker packaging: **3/3** Node artifact regressions; built API process **3/3** smoke checks (liveness provenance, database readiness provenance, anonymous identity no-store). The owned API process stopped with `SIGTERM`. All 17 copied SQL files match their originals. This smoke used PGlite; it is not a native PostgreSQL production-artifact deployment test.

TypeScript: all **11** workspace checks passed; mobile and API-client checks were repeated after the final progress-lookup change. Repository ESLint: **1,091 files, zero errors, zero warnings**. Final generated type-reference restoration and whitespace/preservation checks are recorded below.

Builds: API and standalone worker production bundles passed (approximately 296 KB each); the final Next production build passed; the full OpenNext Cloudflare adapter build passed and emitted `.open-next/worker.js`. The copied worker script's SHA-256 matches the final source (`9AD11FDE96C3165E4C6B8623036F8A52688017B4AF62D87024D25406E1358A12`). Expo offline Android JavaScript/Hermes export passed (2,081 modules, 27 assets, approximately 5.3 MB bundle). Expo did not run an APK build, EAS, emulator or handset. Android tooling was unavailable locally.

The adapter shortcut `--skipNextBuild` failed after an ordinary Next rebuild lacked its required standalone `pages-manifest.json`. That is retained as a failed command, not a passing adapter gate; the full supported adapter rerun passed. OpenNext's Windows partial-compatibility and Next middleware deprecation warnings remain release risks. No Cloudflare preview/deployment or actual ASSETS response was verified. Local build artifacts contain synthetic loopback API URLs and are test outputs, not production release artifacts.

Initial red tests, fixture failures and overloaded setup timeouts are retained in ignored logs. They are not counted as passes. The scoped reports distinguish real failing regressions from date-format, HTTP-status expectation, browser activation synchronization and startup sequencing errors.

Native follow-up failures included a one-cue measurement fixture and race assertions that excluded valid `SKIP LOCKED` schedules; these were corrected with exact ownership/conservation assertions and an unlocked recovery poll. Shutdown waits initially failed despite eventual process termination: synchronous pipe handling was replaced with an asynchronous wait, and a slow disk checkpoint required a bounded 60-second test-runner shutdown allowance. Application worker deadlines did not change. The first built-API check failed before packaging fixes; a later cleanup assertion incorrectly treated signal exit as a running process. Both failed logs are preserved; the final smoke checks exit/signal state correctly and passes. No failed, skipped or interrupted command is included in the green totals.

## Changed files and next steps

Compared with the saved starting snapshot: **497 paths; 439 unchanged states, 58 deliberately edited existing files, 32 added files, no newly missing paths**. The two already-deleted landing-preview paths remain absent. All package manifests/lockfile, database source/schema/migrations/journal, domain types, reviewed forward/rollback SQL and DESIGN.md retain their baseline bytes. Branch/HEAD remain unchanged and the index is empty. Generated next-env.d.ts matches its saved prebuild bytes; tracked asset headers were regenerated with the documented default rather than the synthetic test-build URL. Canonical git diff --check passed; CRLF conversion notices are not whitespace failures.

This inventory is relative to the starting working tree, including existing untracked files. It does not attribute earlier redesign, schema, dependency or layout work to this phase. Ignored runtime/evidence/build directories are excluded.

| Change in this phase | File |
|---|---|
| Edited | [.env.example](<D:/Claude Code Projects/Podcast/.env.example>) |
| Edited | [.github/workflows/ci.yml](<D:/Claude Code Projects/Podcast/.github/workflows/ci.yml>) |
| Edited | [.github/workflows/keepalive.yml](<D:/Claude Code Projects/Podcast/.github/workflows/keepalive.yml>) |
| Edited | [apps/api/build.js](<D:/Claude Code Projects/Podcast/apps/api/build.js>) |
| Added | [apps/api/scripts/test-build-packaging.mjs](<D:/Claude Code Projects/Podcast/apps/api/scripts/test-build-packaging.mjs>) |
| Added | [apps/api/src/ai/align/publication.test.ts](<D:/Claude Code Projects/Podcast/apps/api/src/ai/align/publication.test.ts>) |
| Edited | [apps/api/src/ai/align/run.ts](<D:/Claude Code Projects/Podcast/apps/api/src/ai/align/run.ts>) |
| Added | [apps/api/src/ai/align/service.test.ts](<D:/Claude Code Projects/Podcast/apps/api/src/ai/align/service.test.ts>) |
| Edited | [apps/api/src/ai/align/service.ts](<D:/Claude Code Projects/Podcast/apps/api/src/ai/align/service.ts>) |
| Edited | [apps/api/src/ai/queue-settlement.test.ts](<D:/Claude Code Projects/Podcast/apps/api/src/ai/queue-settlement.test.ts>) |
| Edited | [apps/api/src/ai/queue.ts](<D:/Claude Code Projects/Podcast/apps/api/src/ai/queue.ts>) |
| Edited | [apps/api/src/ai/transcribe-lifecycle.test.ts](<D:/Claude Code Projects/Podcast/apps/api/src/ai/transcribe-lifecycle.test.ts>) |
| Edited | [apps/api/src/ai/transcribe.ts](<D:/Claude Code Projects/Podcast/apps/api/src/ai/transcribe.ts>) |
| Edited | [apps/api/src/ai/worker.ts](<D:/Claude Code Projects/Podcast/apps/api/src/ai/worker.ts>) |
| Edited | [apps/api/src/auth/auth.test.ts](<D:/Claude Code Projects/Podcast/apps/api/src/auth/auth.test.ts>) |
| Edited | [apps/api/src/auth/auth.ts](<D:/Claude Code Projects/Podcast/apps/api/src/auth/auth.ts>) |
| Edited | [apps/api/src/auth/plugin.ts](<D:/Claude Code Projects/Podcast/apps/api/src/auth/plugin.ts>) |
| Added | [apps/api/src/auth/revocation.test.ts](<D:/Claude Code Projects/Podcast/apps/api/src/auth/revocation.test.ts>) |
| Added | [apps/api/src/build-provenance.test.ts](<D:/Claude Code Projects/Podcast/apps/api/src/build-provenance.test.ts>) |
| Added | [apps/api/src/build-provenance.ts](<D:/Claude Code Projects/Podcast/apps/api/src/build-provenance.ts>) |
| Edited | [apps/api/src/config.test.ts](<D:/Claude Code Projects/Podcast/apps/api/src/config.test.ts>) |
| Edited | [apps/api/src/config.ts](<D:/Claude Code Projects/Podcast/apps/api/src/config.ts>) |
| Added | [apps/api/src/feed/fetch.test.ts](<D:/Claude Code Projects/Podcast/apps/api/src/feed/fetch.test.ts>) |
| Edited | [apps/api/src/feed/fetch.ts](<D:/Claude Code Projects/Podcast/apps/api/src/feed/fetch.ts>) |
| Edited | [apps/api/src/feed/transcript.test.ts](<D:/Claude Code Projects/Podcast/apps/api/src/feed/transcript.test.ts>) |
| Edited | [apps/api/src/feed/transcript.ts](<D:/Claude Code Projects/Podcast/apps/api/src/feed/transcript.ts>) |
| Edited | [apps/api/src/feed/url-guard.test.ts](<D:/Claude Code Projects/Podcast/apps/api/src/feed/url-guard.test.ts>) |
| Edited | [apps/api/src/feed/url-guard.ts](<D:/Claude Code Projects/Podcast/apps/api/src/feed/url-guard.ts>) |
| Edited | [apps/api/src/routes/health.ts](<D:/Claude Code Projects/Podcast/apps/api/src/routes/health.ts>) |
| Edited | [apps/api/src/routes/library.ts](<D:/Claude Code Projects/Podcast/apps/api/src/routes/library.ts>) |
| Added | [apps/api/src/routes/transcripts.test.ts](<D:/Claude Code Projects/Podcast/apps/api/src/routes/transcripts.test.ts>) |
| Edited | [apps/api/src/routes/transcripts.ts](<D:/Claude Code Projects/Podcast/apps/api/src/routes/transcripts.ts>) |
| Edited | [apps/api/src/security.test.ts](<D:/Claude Code Projects/Podcast/apps/api/src/security.test.ts>) |
| Edited | [apps/api/src/server.ts](<D:/Claude Code Projects/Podcast/apps/api/src/server.ts>) |
| Added | [apps/api/src/test/native/queue.native.ts](<D:/Claude Code Projects/Podcast/apps/api/src/test/native/queue.native.ts>) |
| Added | [apps/api/vitest.native.config.ts](<D:/Claude Code Projects/Podcast/apps/api/vitest.native.config.ts>) |
| Edited | [apps/mobile/app/episode/[id].tsx](<D:/Claude Code Projects/Podcast/apps/mobile/app/episode/[id].tsx>) |
| Edited | [apps/mobile/app/signin.tsx](<D:/Claude Code Projects/Podcast/apps/mobile/app/signin.tsx>) |
| Edited | [apps/mobile/app/transcript/[id].tsx](<D:/Claude Code Projects/Podcast/apps/mobile/app/transcript/[id].tsx>) |
| Edited | [apps/mobile/lib/auth-token.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/auth-token.ts>) |
| Added | [apps/mobile/lib/downloads/files.test.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/downloads/files.test.ts>) |
| Edited | [apps/mobile/lib/downloads/files.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/downloads/files.ts>) |
| Added | [apps/mobile/lib/downloads/store.test.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/downloads/store.test.ts>) |
| Edited | [apps/mobile/lib/downloads/store.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/downloads/store.ts>) |
| Added | [apps/mobile/lib/offline-session.test.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/offline-session.test.ts>) |
| Edited | [apps/mobile/lib/player/native-engine.test.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/player/native-engine.test.ts>) |
| Edited | [apps/mobile/lib/player/native-engine.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/player/native-engine.ts>) |
| Added | [apps/mobile/lib/player/store.test.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/player/store.test.ts>) |
| Edited | [apps/mobile/lib/player/store.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/player/store.ts>) |
| Added | [apps/mobile/lib/session-lifecycle.test.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/session-lifecycle.test.ts>) |
| Added | [apps/mobile/lib/session-lifecycle.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/session-lifecycle.ts>) |
| Added | [apps/mobile/lib/session.test.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/session.test.ts>) |
| Edited | [apps/mobile/lib/session.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/session.ts>) |
| Edited | [apps/mobile/lib/sync/outbox.test.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/sync/outbox.test.ts>) |
| Edited | [apps/mobile/lib/sync/outbox.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/sync/outbox.ts>) |
| Added | [apps/mobile/lib/transcript-query.test.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/transcript-query.test.ts>) |
| Added | [apps/mobile/lib/transcript-query.ts](<D:/Claude Code Projects/Podcast/apps/mobile/lib/transcript-query.ts>) |
| Edited | [apps/web/components/player/speed-control.tsx](<D:/Claude Code Projects/Podcast/apps/web/components/player/speed-control.tsx>) |
| Edited | [apps/web/components/transcript/transcript-panel.tsx](<D:/Claude Code Projects/Podcast/apps/web/components/transcript/transcript-panel.tsx>) |
| Added | [apps/web/lib/csp.test.ts](<D:/Claude Code Projects/Podcast/apps/web/lib/csp.test.ts>) |
| Edited | [apps/web/lib/modal-sheet.ts](<D:/Claude Code Projects/Podcast/apps/web/lib/modal-sheet.ts>) |
| Edited | [apps/web/lib/on-screen.ts](<D:/Claude Code Projects/Podcast/apps/web/lib/on-screen.ts>) |
| Added | [apps/web/lib/player/progress-sync.test.ts](<D:/Claude Code Projects/Podcast/apps/web/lib/player/progress-sync.test.ts>) |
| Added | [apps/web/lib/player/progress-sync.ts](<D:/Claude Code Projects/Podcast/apps/web/lib/player/progress-sync.ts>) |
| Edited | [apps/web/lib/player/store.ts](<D:/Claude Code Projects/Podcast/apps/web/lib/player/store.ts>) |
| Edited | [apps/web/lib/player/web-engine.test.ts](<D:/Claude Code Projects/Podcast/apps/web/lib/player/web-engine.test.ts>) |
| Edited | [apps/web/lib/player/web-engine.ts](<D:/Claude Code Projects/Podcast/apps/web/lib/player/web-engine.ts>) |
| Edited | [apps/web/lib/service-worker.test.ts](<D:/Claude Code Projects/Podcast/apps/web/lib/service-worker.test.ts>) |
| Added | [apps/web/lib/transcript-reader.ts](<D:/Claude Code Projects/Podcast/apps/web/lib/transcript-reader.ts>) |
| Edited | [apps/web/middleware.ts](<D:/Claude Code Projects/Podcast/apps/web/middleware.ts>) |
| Edited | [apps/web/next.config.ts](<D:/Claude Code Projects/Podcast/apps/web/next.config.ts>) |
| Edited | [apps/web/public/_headers](<D:/Claude Code Projects/Podcast/apps/web/public/_headers>) |
| Edited | [apps/web/public/sw.js](<D:/Claude Code Projects/Podcast/apps/web/public/sw.js>) |
| Edited | [apps/web/scripts/build-headers.js](<D:/Claude Code Projects/Podcast/apps/web/scripts/build-headers.js>) |
| Added | [apps/web/scripts/test-production-web.mjs](<D:/Claude Code Projects/Podcast/apps/web/scripts/test-production-web.mjs>) |
| Added | [apps/web/scripts/test-service-worker-browser.mjs](<D:/Claude Code Projects/Podcast/apps/web/scripts/test-service-worker-browser.mjs>) |
| Added | [apps/web/scripts/test-web-hooks-browser.mjs](<D:/Claude Code Projects/Podcast/apps/web/scripts/test-web-hooks-browser.mjs>) |
| Added | [docs/remediation/phase-25-3a.md](<D:/Claude Code Projects/Podcast/docs/remediation/phase-25-3a.md>) |
| Added | [docs/remediation/phase-25-database.md](<D:/Claude Code Projects/Podcast/docs/remediation/phase-25-database.md>) |
| Added | [docs/remediation/phase-25-security.md](<D:/Claude Code Projects/Podcast/docs/remediation/phase-25-security.md>) |
| Edited | [packages/api-client/src/client.test.ts](<D:/Claude Code Projects/Podcast/packages/api-client/src/client.test.ts>) |
| Edited | [packages/api-client/src/client.ts](<D:/Claude Code Projects/Podcast/packages/api-client/src/client.ts>) |
| Edited | [packages/core/src/download/source.test.ts](<D:/Claude Code Projects/Podcast/packages/core/src/download/source.test.ts>) |
| Edited | [packages/core/src/download/source.ts](<D:/Claude Code Projects/Podcast/packages/core/src/download/source.ts>) |
| Edited | [packages/core/src/player/machine.test.ts](<D:/Claude Code Projects/Podcast/packages/core/src/player/machine.test.ts>) |
| Edited | [packages/core/src/player/machine.ts](<D:/Claude Code Projects/Podcast/packages/core/src/player/machine.ts>) |
| Edited | [render.yaml](<D:/Claude Code Projects/Podcast/render.yaml>) |
| Added | [scripts/build-provenance.d.ts](<D:/Claude Code Projects/Podcast/scripts/build-provenance.d.ts>) |
| Added | [scripts/build-provenance.js](<D:/Claude Code Projects/Podcast/scripts/build-provenance.js>) |
| Added | [scripts/test-native-postgres.mjs](<D:/Claude Code Projects/Podcast/scripts/test-native-postgres.mjs>) |

Before release: review this local report; approve any exact persistent migration and coordinated API/worker cutover separately; verify backups/legacy and account-deletion policies; verify proxy/CORS/health/header settings and credentials; run actual Android/device lifecycle/offline tests; resolve or explicitly accept remaining dependency/adapter risks; then separately approve push/deployment/production changes. No additional action is implicitly approved by this report.

**No UI redesign, production mutation, migration of any pre-existing persistent database, secret access/rotation, paid infrastructure, staging, commit, push, merge, branch switch or deployment occurred.**
