# Stage 1: security and account isolation

Date: 2026-10-12. Scope: local implementation and verification of the approved remediation, prioritizing F01, F02, F03, F04, F05, F07, F27 and F36. Finding identifiers refer to the recent 38-finding audit, not the older root SECURITY-REVIEW.md.

## Changes and supporting evidence

| Finding | Local change | Verification and limits |
| --- | --- | --- |
| F01 | Service-worker v4 uses verified account namespaces for private API responses and protected navigation. `/me` stays network-only. Logout/expiry purges private caches; queued writes check the account generation before caching. | Six worker VM tests cover same-account offline reads, A-to-B switching, 401 expiry, 503 outages, late responses after logout, protected navigation, and bypass of AI/transcript/auth/audio/range requests. No browser-installed-worker or production verification was performed. Cold-start offline identity remains Stage 3 work. |
| F02 | Shared account generations fence API responses, raw banner uploads, streaming callbacks, queue hydration, resume lookups, optimistic subscription callbacks, and player loads. Account changes clear active query data and inactive caches. The client sends its selected account ID; the API compares it with the authenticated session before executing a route. | Real query-observer test clears active/inactive A data; client tests reject old responses, uploads and streams. Real API/PGlite test rejects an A action carried by B's cookie without subscribing B. Core and web/native engine tests reject late playback/seek work. These tests cover the identified paths, not every device or cross-tab UI sequence. |
| F03 | Unsafe cookie-bearing application requests require an exact trusted Origin, including empty-body writes. Better Auth retains its own auth-route protection. Bearer requests without cookies continue to work. | API security/auth suites cover absent, `null`, malicious and allowed origins, cookie-plus-fake-bearer bypass attempts, and native bearer authentication. |
| F04 | Job execution uses the funding source admitted by the request, inferred from the existing `quota_day` field. A deleted or unreadable BYOK key cannot fall back to unreserved operator funding. Alignment carries the admitted funding choice explicitly. | Four real PGlite access tests cover removed BYOK, unreadable BYOK, operator funding after later BYOK enrollment, and zero operator allowance. Admission/lease/refund races remain Stage 2 work. No schema changes were made. |
| F05 | `/auth/send-verification-email` joins the sensitive endpoint limiter. Fastify now trusts only configured proxy IPs/CIDRs; default forwarding-header trust is off. | Auth limiter and proxy/config tests pass, including forged forwarded-address behavior and rejection of invalid/global CIDRs. Deployment requires verified provider proxy addresses; the existing Render hop-count setting has intentionally not been changed. |
| F07 | Native outbox files carry an account ID. Anonymous or stale callbacks cannot enqueue progress. A flush stops when ownership changes, and an old finalizer cannot delete B's entries. SecureStore writes are serialized; logout captures the departing token before local clearing so server revocation uses that token. | Four native outbox tests, one token persistence test, and API-client bearer-sign-out verification pass. Unowned legacy outbox files are discarded rather than assigned to a new user. Offline startup/resume UX remains Stage 3 work. |
| F27 | Feed, artwork and audio downloads use an Undici socket lookup pinned to the checked address snapshot at every hop, preserving the original URL for Host/SNI/certificate verification. IPv6 mapped/private address checks were corrected. | A real local HTTP socket test reaches a non-resolving hostname through the checked address and preserves Host. Lookup tests enforce host/family restrictions; existing redirect/private-address suites pass. No external exploit or production network test was run. |
| F36 | Fresh advisories and published versions were checked before compatible runtime/tooling patches. Fastify 5.12.5, Undici 7.30.0, Sharp 0.35.5, Next/eslint-config-next 16.3.8 and Vitest 4.1.11 are installed. Compatible transitive patches are recorded in root overrides and the lockfile. | Builds, types and regressions pass with the patched lockfile. F36 is **partially resolved**: six packages still have advisories, detailed below. No unsupported major overrides were forced. |

Related safeguards: artwork response-body failures return the existing null fallback (F28), oversized feed bodies are canceled, and production configuration rejects the shipped development signing secret even if explicitly supplied (F30). Focused regression tests verify these behaviors. Service-worker AI/transcript bypass also addresses the stale status-cache path in F13; full transcript functionality remains Stage 3.

## Local validation

The suites were run separately by workspace with Vitest 4.1.11, native config loading, no cache, one thread worker and no file parallelism. Existing committed migrations were used only by the ephemeral PGlite test harness. No proposed migration SQL was executed.

| Workspace | Files | Tests passed |
| --- | ---: | ---: |
| API | 33 | 560 in the final full run; one additional production-secret regression passed in a focused config/artwork run afterward |
| Core | 15 | 252 |
| API client | 1 | 21 |
| Web | 5 | 21 |
| Mobile | 3 | 6 |
| Database | 1 | 18 |
| Design | 3 | 355 |
| i18n | 1 | 55 |
| Motion | 4 | 58 |
| Validation | 2 | 41 |

Total: **1,388 distinct passing tests across 68 files**, combining the full workspace runs and the final focused addition. The last full API run passed 560; its current suite contains 561 including that addition.

Additional gates:

- API, web and mobile TypeScript checks pass.
- ESLint passes for API/core/API-client, mobile security/player/session files and the changed web security/auth/player files.
- API production build passes (`node build.js`); local web production build passes (Next 16.3.8).
- A local Next production server served `/offline`, `/signin` and `/sw.js` with HTTP 200 and CSP; the worker script contains v4. This was a local serving smoke check, not an authenticated browser test. The server was stopped.
- `git diff --check` passes. Generated Next type-reference changes were reverted surgically to their original contents after the build.

An earlier API run overlapped a dependency update and had module-resolution failures. The clean full rerun after installation completed is the evidence used above.

No live-production verification was performed during implementation. No pushes, deployments, production configuration changes, new database migrations, paid services or secret rotations were performed.

## Dependency advisories still open

The public npm bulk advisory endpoint was rechecked at **2026-10-12 13:22 UTC** against **1,208 distinct public package names** in the lockfile. It returned six affected packages and seven advisory records. Registry metadata was then rechecked for published repair branches.

| Installed affected package | Parent chain | Remaining advisory / decision |
| --- | --- | --- |
| esbuild 0.18.20 | `@esbuild-kit/core-utils` through Drizzle tooling | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), moderate. Patched modern esbuild copies are also installed; the old parent pins `~0.18.20`. A tooling migration needs separate compatibility work. |
| braces 3.0.3 | micromatch | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high. 3.0.3 remains the registry's latest version; no published patched version was available. |
| decode-uri-component 0.2.2 | query-string 7 | [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), moderate. Current published latest is 0.5.0; the parent's range is `^0.2.2`. The available 0.4 branch is also inside the advisory range. |
| image-size 1.2.1 | Metro 0.84.4 | [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), high. Published patched 2.0.3/2.0.4 require a major upgrade outside Metro's `^1.0.2` range. |
| node-forge 1.4.0 | Expo CLI / Expo code-signing certificates | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), high. 1.4.0 remains latest; no published patched version was available. |
| uuid 7.0.3 | xcode 3.0.1 | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), moderate. Repair requires 11.1.1+ outside the parent's `^7.0.3` range. |

These are dependency findings, not proof that every advisory is exploitable in the deployed app. Neither a zero-advisory result nor full mobile release validation is claimed.

## Diff preservation and stage gates

Work began with **42 tracked changes and 8 untracked files** already present, including extensive UI work. Those were retained; no reset, clean, stash or overwrite of user work was used. The overall Git diff includes that earlier work and must not be mistaken for a redesign performed in this stage. Stage 1 adds account/security logic, transport/dependency changes and focused tests. No visual redesign was started.

The database schema/migrations, Render blueprint, CI workflows, web deployment configuration and production headers have no Stage 1 edits. `.env.example` documents the new local proxy configuration; actual secrets were not read out, replaced or rotated.

Stage 2's connected job admission, lease ownership, final save and refund work is waiting on the [exact migration proposal](stage-2-migration-proposal.md). Stage 3 functional work is still pending. Separate production approvals remain necessary for all deployment actions.

Before a future deployment:

1. Resolve verified proxy-address configuration. Existing `TRUST_PROXY_HOPS=1` without an allowlist now fails startup intentionally; guessing provider CIDRs would undermine the rate limiter.
2. Resolve the audit's Render health-path, Vercel CORS, Cloudflare headers and CI credential blockers under Stage 4's separate approval. These were not changed or freshly production-tested here.
3. Coordinate API/web/mobile release compatibility. The client account-intent header and worker response-owner checks require the matching API behavior. Stage 1's secure worker declines private caching without the new response-owner header.
4. Run browser-installed-worker and real-device account-switch checks before claiming production closure. Local VM and mocked native tests do not establish those outcomes.
