# Security review — Cue API

**Scope:** whole monorepo, with depth on the Fastify API (`apps/api`). Static
audit of every route, parser, auth path and guard, plus live black-box and
grey-box exploitation against a booted server (PGlite in-memory DB). Clients
(`apps/web`, `apps/mobile`), dependencies and on-disk secrets reviewed.

**Result:** 3 real vulnerabilities found and fixed, each with a regression test.
Full suite green afterwards — **315 tests, 20 files** (baseline was 304/19).
Branch: `security/ssrf-dos-auth-hardening`.

This is a security-aware codebase: the SSRF guard, the proxy-hop trust model, the
sanitise-at-ingest XSS boundary, the atomic AI quota, and the ownership scoping
are all already correct. The bugs that remained were at the seams — one fetch
path that skipped the guard everything else went through, and one set of routes
that skipped the limiter everything else went through.

---

## Findings

### 1 — HIGH · Unauthenticated SSRF via artwork colour extraction

`extractArtworkColor` (`apps/api/src/feed/artwork-color.ts`) fetched its URL with
a bare `fetch()` — **no SSRF guard, default redirect-following**. That URL is a
feed's `<itunes:image href="…">`, which comes out of RSS anyone can publish, and
the fetch runs server-side inside the deployment's network.

Reachable **unauthenticated** two ways:

- `POST /podcasts` (anonymous feed ingest) → `ingestFeed` → `extractArtworkColor`
  on the channel artwork, at ingest time.
- `GET /episodes/:id/tint` (anonymous, repeatable) → `extractArtworkColor` on the
  episode artwork.

An attacker publishes a feed whose artwork href is `http://169.254.169.254/…`
(cloud metadata / IAM credentials), `http://127.0.0.1:…` (internal admin panels,
DB consoles), or any private host, then triggers a fetch. Redirect-following made
it worse: a *public* href that `302`s into the private network was followed
silently.

**Proved live.** The guard correctly classifies these targets as private, yet the
old fetch reached an attacker-controlled internal listener anyway, and followed a
`302` from a public path into `/aws/credentials`:

```
checkUrl(http://127.0.0.1:.../internal)      -> BLOCKED: loopback
extractArtworkColor(http://127.0.0.1:.../…)  -> internal listener HIT: YES  *** SSRF ***
extractArtworkColor(.../redir)               -> followed to /aws/credentials  *** redirect SSRF ***
```

**Fix.** Route the fetch through the same `checkUrl` guard the feed fetcher uses,
re-validating **every redirect hop** with `redirect: 'manual'`. After the fix the
same PoC shows `internal listener HIT: no` and an empty redirect chain.

### 2 — MEDIUM · Memory-exhaustion DoS in the same fetch

The old code did `await response.arrayBuffer()` and only *then* checked the size,
and its pre-check trusted the `content-length` header — written by the same server
being fetched. A host (or an SSRF'd internal endpoint) declaring `content-length:
10` while streaming gigabytes forced the whole body into memory before any check
ran. Measured a ~29 MB resident-set jump from a single 20 MB lie; nothing caps how
far that goes on a 512 MB container.

**Fix.** Stream the body with a running byte total and abort past the ceiling —
the same shape `feed/fetch.ts` already used. `content-length` is now only an early
reject, never the real limit.

Findings 1 and 2 fixed together in `apps/api/src/feed/artwork-color.ts`; regression
tests in `apps/api/src/feed/artwork-color.test.ts`.

### 3 — MEDIUM · No durable throttling on credential endpoints

The `/auth/*` routes are Better Auth's and **bypass the app's per-route rate-limit
preHandler entirely**. Better Auth's built-in limiter is disabled outside
production and in-memory within it (per-instance, reset every deploy) — so there
was no durable brake on online password guessing or credential stuffing.

**Proved live:** 60 wrong-password `sign-in` attempts in 12 s, **zero** rate-limited.

**Fix.** An address-keyed `auth` tier (`apps/api/src/rate-limit.ts`) applied in the
auth `onRequest` hook to the credential-checking paths — `sign-in`, `sign-up`,
`forget-password`, `reset-password` — before Better Auth's scrypt runs. The
read-only `get-session` that fires on every page load is deliberately left alone.
IP-keyed rather than per-account lockout on purpose: lockout lets an attacker deny
a victim service by guessing at their account. Regression test in
`apps/api/src/security.test.ts`.

---

## Tested and found safe (no change needed)

| Area | Verdict |
| --- | --- |
| **XML billion-laughs / XXE** | `fast-xml-parser` v5 does not expand DTD entities. Payload with 5 nested entities did not amplify. |
| **IDOR** (playlists/library/queue/progress) | Every query scoped by the session user id; cross-user read returns 404. Confirmed live. |
| **CORS** | Exact-origin allowlist; `evil.example` and the suffix trick `cue.example.attacker.com` both get no `Access-Control-Allow-Origin`. |
| **Anonymous access to `/me/*`** | 401, via a single `requireUser` boundary resolved once per request. |
| **CSRF** | `text/plain` parser removed; JSON-only bodies force a preflight; `SameSite=None` cookie is not the control. Existing tests cover it. |
| **Session cookie flags** | `httpOnly` + `Secure` + `SameSite=None` in prod, `Lax`/insecure in dev. Correct. |
| **SQL injection** | Drizzle parameterised throughout; the one `array_agg` raw fragment interpolates no user input. |
| **Proxy / `X-Forwarded-For` spoofing** | Hop-count trust model; `request.ip` cannot be forged to bypass IP limits. |
| **Stored XSS in show notes** | `sanitize-html` allowlist at the ingest boundary; `dangerouslySetInnerHTML` only ever sees sanitised markup. |
| **BYOK key storage** | AES-256-GCM, fresh IV per encrypt, key never returned to any client, verified against Groq before storage. |
| **AI quota** | Claimed atomically before the call, refunded on upstream failure — no check-then-increment race. |
| **Mobile token storage** | Android keystore via `expo-secure-store`, sent as a bearer header. |
| **Error handling** | Generic 500s; no Postgres/schema strings leak; malformed JSON is a clean 400. |
| **Secrets in git history** | Clean — only `.env.example` was ever committed. |

---

## Notes / recommended follow-ups (not code-fixed here)

- **Live secrets on disk.** `.env` and `.env.env` hold real credentials (Groq key,
  DB URL, `BETTER_AUTH_SECRET`, `API_KEY_ENCRYPTION_SECRET`). Correctly gitignored
  and never committed — but if that machine is shared or backed up, rotate them.
  `.env.env` also has an empty `API_KEY_ENCRYPTION_SECRET` (would silently disable
  BYOK); delete the stray duplicate env files to avoid loading the wrong one.
- **DNS-rebinding TOCTOU.** `url-guard.ts` documents this residual: the guard
  validates resolved addresses, then `fetch` re-resolves the hostname. Closing it
  fully means a pinned-IP undici dispatcher shared by `fetch.ts`, `audio.ts` and
  now `artwork-color.ts`. The SSRF fix here inherits the same accepted limitation
  as the existing fetchers — consistent, not a new gap — but the dispatcher is the
  right next step if this hardens further.
- **`npm audit`.** Only devDependencies flagged (`esbuild` via `drizzle-kit`;
  `image-size` via `metro`/`expo`). None are in the production API runtime.

---

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint` on all changed files — clean.
- `npx vitest run` (full API suite) — **315 passed, 20 files**.
- SSRF PoC re-run against the patched code — internal listener no longer reached,
  redirect chain empty, memory delta ~0.
