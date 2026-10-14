# Keepalive and Render failure investigation

Investigated on 2026-10-14 using the user-confirmed Render workspace, live deployment records and build/application logs. No environment secret values were read or printed. No database migration was run.

## Keepalive failure

The [failed Keepalive run](https://github.com/redbull990145-blip/Podcast/actions/runs/38563632578) exited immediately because the workflow's `API_URL` secret was empty. It never sent a readiness request. The email's three-second failure was a configuration failure, not a failed API build or database response.

The workflow now resolves the public repository variables `API_URL` and `NEXT_PUBLIC_API_URL`, then the legacy secret. It defaults to this repository's verified public API only when running in the original repository; forks must configure their own endpoint. Missing or unsafe configuration still fails with sanitized output. The schedule runs away from the hour boundary, with concurrency control and a six-minute job limit.

A dedicated probe allows three attempts with a 90-second request timeout and five-second gaps. It retries network failures, timeouts, HTTP 408/429 and server errors, and requires the actual JSON database-readiness response. HTML and liveness-only HTTP 200 responses fail. Logs print attempt counts/statuses without URLs, bodies or raw provider errors.

Eight regression tests passed, including actual timeout cancellation and redacted error behavior. The new script also ran against the public deployment successfully: `API and database ready (attempt 1/3)`. A successful scheduled GitHub run must be verified after the workflow is pushed.

The final local validation passed all 11 workspace lint tasks, all 11 workspace type-check tasks, and the nine non-API workspace test tasks (929 tests, including 68 web tests; unchanged suites reused verified Turbo cache entries). The API run passed 674 of 675 tests; one existing large-MP3 case exceeded its unchanged 30-second deadline during the concurrent build. Its entire ten-test file passed on an isolated rerun in 20 seconds. No test timeout or audio implementation was changed. The Keepalive/private-file guard checks separately passed 13/13, and the focused script lint passed without warnings.

## Confirmed cause

The [failed cleanup deployment](https://dashboard.render.com/web/srv-da0qice1egvs739brtc0/deploys/dep-db78v6tbedkc738adrqg) checked out `72b1226807aee4ef5bf50066eef194be5e5a3e87`. Its API build succeeded at **2026-10-13 20:08:50 UTC** (October 14, 01:38:50 IST). The new process then exited at **20:09:42 UTC** with:

```text
Failed to start: TRUST_PROXY_HOPS is no longer supported; configure verified TRUST_PROXY_ADDRESSES before deploying
```

The API configuration now refuses to infer trusted proxy identity from a hop count. The existing Render service retained a positive legacy `TRUST_PROXY_HOPS` setting without a verified address allowlist. Editing the repository Blueprint had not reconciled that independently configured live setting. The same startup problem also affected the preceding `057ee9d` deployment. Removing the unused web module and ESLint export did not break the API bundle.

The failed deployment did not replace the running service. At the start of this investigation, Render still reported the August 22 `0af06a04f045213d010a5b75be08261b8609e7ae` deployment as live. A healthy old API therefore could not prove that the new release had succeeded.

## Repair

The Blueprint explicitly sets `TRUST_PROXY_HOPS=0` so applying it clears an existing positive legacy setting. The operational repair is to merge the same non-secret setting into the existing service's environment while preserving all other variables, especially any verified `TRUST_PROXY_ADDRESSES` allowlist. With no address allowlist, the API ignores forwarding headers; the startup guard against positive hop-only trust remains enabled.

Ignoring forwarding headers means requests arriving through a Render proxy can share that proxy's IP rate budget. This can affect sign-in and other IP-limited routes under load. A future trusted-address configuration must verify the actual incoming proxy chain and its provider-controlled address ranges; copying observed private IPs or trusting all addresses would weaken spoofing protection. The shared server-renderer token is a separate catalogue-only mechanism and does not exempt authentication routes.

The live service also had no health-check path at investigation time, although the Blueprint already declares `/health`. `/health` checks liveness; `/health/ready` independently checks database readiness. Changing the source declaration does not update an independently managed service automatically.

Render selected Node **26.11.1** from the open-ended repository range `>=20.18.1`. The build and startup module loading completed; that runtime selection was not the recorded cause of this failure.

## Local validation

- API and standalone worker production bundles built successfully.
- Existing packaging regressions passed **3/3**, including bundled workspace source, external runtime dependencies and exact migration-file copies. Copying the migration files does not apply them.
- A synthetic production configuration reproduced the exact legacy-hop failure. Changing only the hop count to zero passed configuration validation and kept proxy-header trust disabled. No database connection or real environment file was used.
- Existing API configuration regressions passed **17/17**, including zero-hop trust, explicit address validation and rejection of positive hop-only configuration.
- Render YAML parsed successfully; the zero-hop setting, operator-supplied address allowlist and `/health` declaration were verified.

The first local build attempt encountered the sandbox's `spawn EPERM` restriction. The permitted rerun completed successfully; that sandbox failure is not the Render failure.

## Live repair verification

Merging `TRUST_PROXY_HOPS=0` with `replace:false` triggered a redeployment automatically. The [repaired deployment](https://dashboard.render.com/web/srv-da0qice1egvs739brtc0/deploys/dep-db7prueq1p3s73dbi5gg) of the previously pushed `72b1226` revision finished successfully at **2026-10-14 15:23:26 UTC** (20:53:26 IST). Startup logs confirmed that the API listened on port 10000 and the proxy-configuration failure no longer occurred.

Public verification then returned **200** from both `/health` and `/health/ready`, each identifying the exact `72b1226807aee4ef5bf50066eef194be5e5a3e87` revision with `dirty:false`. Readiness reported a database latency of **3 ms** and a connected cache. This proves the repaired API is serving the requested commit, rather than the previously retained August build.

Startup also revealed a separate feature limitation: the transcription worker logged that its approved database migration was missing or incompatible and continued waiting. After the user confirmed the production target and approved only migration 0016, a private scoped recovery backup and cutover checks completed. The existing Drizzle runner applied only 0016 successfully; the actual schema guard, migration history, original indexes and RLS checks passed. Render then logged “transcription worker started” at **2026-10-14 15:41:17 UTC**. Public liveness/readiness remained 200 with the exact `72b1226` revision; readiness measured **2 ms**. See [the migration execution evidence](transcription-production-migration-draft.md). Legacy jobs and quota records were preserved; no paid transcription was initiated. Startup also warned that the catalogue renderer token is absent, so catalogue rate limiting remains disabled as documented by the existing configuration.

## Final source publication verification

The environment repair above preceded publication of the new repository changes. After the source push, confirm the automatically triggered deployment's exact new commit, `live` status and public liveness/readiness provenance. Do not dispatch a second deploy while automatic deployment is enabled. The parent task records the final revision outcome after those checks complete.
