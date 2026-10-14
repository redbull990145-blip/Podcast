# Secret exposure verification

Verified on 2026-10-14. No real credential exposure was found in the checks below. This report records a scan of available repository history and observed public assets; it does not claim that forks, unknown refs, provider logs or user browser storage were examined.

## Repository and history

- The committed snapshot contains no real `.env` file, credential file, local database directory or build-output directory. Only `.env.example` is tracked; its settings are placeholders or empty credential values.
- Existing `.gitignore` rules cover `.env`, `.env.env`, `.env (2)`, local PGlite data, dependency directories, Next output and OpenNext/Cloudflare local state. Real local files were preserved and remain ignored.
- Available Git history: 78 commits, 3,203 objects. Historical filename checks found only `.env.example`, with no committed real environment files or PGlite data in these refs.
- [Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), downloaded from its official release and checked against the published checksum, scanned both the committed snapshot and all available refs. Initial results were one current and two historical public encryption-test fixtures. After inspecting them, a narrow allowlist constrains both exact fixture values and exact test filenames. No other findings remained. Test directories and generic key rules were not broadly excluded.
- An independent comparison of every one of the 1,837 historical file blobs (22,419,846 bytes) against 13 locally configured credential values found no matches. Values were not printed or saved in the report.

## Deployed frontend

The initial public verification used deployed revision `72b1226807aee4ef5bf50066eef194be5e5a3e87`:

- Compared 14 locally configured values against 23 public HTML, JavaScript, CSS and service-worker assets: no matches.
- Requests for `/.env`, `/.env.env`, `/.env%20(2)`, `/.git/config`, `/.pglite-dev/` and `/apps/api/src/config.ts` returned 404.
- Public client environment variables contain API/web base URLs. These URLs are necessary for browser/mobile requests and are not authentication credentials.
- User-supplied AI keys are entered in the user's browser, sent to the API, and cleared from form state after saving. The server encrypts stored keys and returns a last-four-character hint. Such user input is separate from operator credentials embedded in a build.

## Boundary fix and future protection

The shared web API module formerly contained private `INTERNAL_API_TOKEN` handling alongside the browser client. No real token value was found in its public bundles, but the environment-variable and private-header names appeared in browser code. Moved the catalogue client into a dedicated `server-only` module and updated its four server consumers. Browser `lib/api.ts` now contains no private token/header handling; Next rejects accidental client imports of the server module.

Added CI checks that:

1. Reject tracked real environment files, credential-file extensions, private-data folders and generated output.
2. Reject secret-like public environment variable names in production app/shared code.
3. Scan full available Git history with pinned, checksum-verified Gitleaks and fully redacted logs.
4. Scan generated Next browser chunks and OpenNext public assets for credential patterns.

The file guard's five regression tests passed, including safe template allowance, environment-file and directory rejection, database/build-folder rejection, public-secret-variable rejection and suppression of fixture contents in its output. Web TypeScript and 68 web tests passed; focused lint passed. The corrected catalogue account-header assertions were rerun separately and passed 2/2.

The Next production compilation and TypeScript checks completed. The generated browser chunks (55 files, about 1.63 MB) and OpenNext public assets (61 files, about 1.64 MB) both passed Gitleaks 8.30.1 with fully redacted output and comment-based suppressions disabled. Independent byte comparisons found no synthetic internal token, `INTERNAL_API_TOKEN` name or `x-cue-internal` header in either public asset tree. A further comparison against five locally configured credential values found no matching public files. Values were inspected in memory and were not printed or written to this report.

The OpenNext adapter was rerun with `--skipNextBuild` against the completed production output and finished successfully with exit code 0 (`OpenNext build complete`). The worker, default server handler, middleware and durable-object files were generated. After the adapter rerun, both public asset trees passed Gitleaks again and the independent private-token/header marker comparison remained clear. An initial attempt encountered Windows sandbox `spawn EPERM`; the subsequent authorized local run allowed Wrangler to start esbuild and completed the verification.

The build used a process-only synthetic internal token and synthetic public API origin. No local environment file was changed, proof artifacts were not uploaded, and the generated tracked `_headers` file was restored to its pre-build content after inspecting its diff.

No history rewrite or credential rotation was performed because these checks found no exposed real credential. Existing proof screenshots and reports contain deployment/account metadata and local paths; those are review evidence, rather than API keys or authentication secrets.
