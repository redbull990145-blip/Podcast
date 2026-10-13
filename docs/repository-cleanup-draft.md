# Draft: repository cleanup review

Inspected on 2026-10-14. **No files were deleted and no cleanup was performed.** This draft proposes a separate cleanup change; it does not change the validated deployment/security fixes.

## Confirmed tracked cleanup candidates

| Candidate | Evidence | Proposed action |
| --- | --- | --- |
| `apps/web/lib/color-lerp.ts` (6,312 bytes) | No import or file-path reference in tracked source, scripts or existing documentation. Its exported `parseColor`, `lerpColor`, `buildRamp`, `rampAt` and `ColorRamp` names occur only inside this module. `components/shell/now-playing-tint.tsx` now writes the palette once and animates a composited bloom instead of interpolating document-wide colours every frame. | Remove the unused module in a separate cleanup commit; run web TypeScript, lint and the tint/transition regression tests afterward. |
| `packages/config/package.json`, export `./eslint/react` | Points to `./eslint/react.js`, which does not exist. No current tracked consumer imports `@cue/config/eslint/react`. | Remove the dangling export, or implement it if a consumer is planned. This is stale configuration, not an existing file to delete. Check all workspace lint afterward. |

No other tracked dead modules were confirmed by this quick reference audit. Framework conventions and dynamic loading mean absence of a text reference alone is not a general deletion rule.

## Local files worth reviewing

These are already ignored by Git, so they are not included in the commit or push:

| Files/directories observed | Classification and recommendation |
| --- | --- |
| `apps/web/.next/`, `apps/web/.open-next/`, `apps/api/dist/`, root/workspace `.turbo/`, workspace `*.tsbuildinfo` | Generated build output or caches. Can be rebuilt; clear selectively after stopping active builds/dev servers when reclaiming disk space is needed. |
| Root/workspace `node_modules/`, `apps/mobile/.expo/` | Local dependencies and Expo state. Not dead application code. Reinstallable/regenerable, but removing them interrupts local development; routine deletion is unnecessary. |
| `.env (2)`, `.env.env` | Possible duplicate local environment files. The configured API commands load the root `.env`; neither duplicate filename is configured by those commands. Contents were **not opened or compared**, so duplication and lack of manual/external use are unconfirmed. Review privately before removing either file; never commit their contents. |
| `apps/web/.wrangler/` | Local Cloudflare state, including simulated storage. Review before clearing because this may contain development data, not just caches. |

## Preserve

- `apps/api/.pglite-dev/`: a real local database. Do not classify it as disposable cache.
- `.claude/worktrees/` and its lock state: managed checkouts may contain independent work. Inspect their Git state before any cleanup.
- `packages/db/migrations/`, migration snapshots/journal, and `docs/remediation/stage-2-forward.sql` / `stage-2-rollback.sql`: the SQL documentation files are read directly by database and native integration tests. Their similarity to migration files is intentional.
- Next/Expo route files, config files, icons, `AGENTS.md` and `CLAUDE.md`: some are loaded by convention rather than imports. `CLAUDE.md` delegates to `AGENTS.md`; it is not an accidental duplicate.
- Manual verification scripts under `apps/web/scripts/` and `scripts/`: their historical reports reference them even when npm scripts do not invoke them automatically.
- Proof screenshots and security/remediation reports: these are review evidence. Archive older reports only after preserving test dependencies and useful references. The new Cloudflare screenshots are linked from the verification report.
- Generated **tracked** `apps/web/public/_headers` and `apps/web/app/tokens.css`: deployment/build inputs with generators; do not remove them merely because they are generated.

## Proposed next cleanup

1. Remove the one confirmed unused colour-interpolation module and resolve the dangling ESLint export.
2. Run the checks noted above and review the diff for behaviour changes.
3. Separately review local environment duplicates and select regenerable caches if storage cleanup is desired.

Tracked-file checks found no committed `.log`, `.tsbuildinfo`, `.bak`, `.tmp`, `.orig`, ZIP, executable or database files. This was a quick inventory/reference audit, not a guarantee that every export or dependency is used.
