# Cadence

A podcast web app built around a list of complaints about the big ones: playback
you can't control properly, sync that loses your place, opaque recommendations,
and no way to take your subscriptions with you.

It's an **aggregator**, not a host — you subscribe to shows by RSS and audio
streams straight from each publisher. We never store or proxy audio, which is
what keeps running costs at roughly zero.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Scaffolding, schema, auth, app shell | ✅ Done |
| 1 | Search, subscribe, browse, play, resume | ✅ Done |
| 2 | Queue, cross-device sync, OPML, offline/PWA | ✅ Done |
| 3 | AI transcripts, show notes, episode Q&A | ✅ Done |
| 4 | Recommendations, power mode, polish | Next |

## Stack

- **Next.js** (App Router) on Vercel's free tier
- **Supabase** — Postgres, auth, and Realtime for cross-device sync
- **Drizzle ORM** with plain-SQL migrations
- **Tailwind v4** with semantic design tokens, light and dark
- **Zustand** for player state, **TanStack Query** for server state

## Setup

### 1. Install

```bash
npm install
```

### 2. Create a Supabase project

Free tier is fine. From **Project Settings → API** and **→ Database**, copy the
values into `.env.local`:

```bash
cp .env.example .env.local
```

You need `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` to run Phase 0.

### 3. Create the tables

```bash
npm run db:push
```

Then open the Supabase SQL editor and run
[`supabase/migrations/0001_auth_and_rls.sql`](supabase/migrations/0001_auth_and_rls.sql).
This step is **not optional** — it adds the foreign key to `auth.users`, the
trigger that creates a profile row on signup, and every row-level security
policy. The anon key ships to every browser, so without RLS any user could read
any other user's library.

### 4. Run it

```bash
npm run dev
```

## Design notes

**Nothing is paywalled.** Power-user mode is a UI density toggle, not an upgrade
prompt. OPML export sits in plain sight in Settings.

**AI works without a key.** Summaries, chapters and episode Q&A run on the
operator's own API keys with a modest daily per-user quota. Adding your own key
in Settings removes the quota entirely and routes calls straight from your
browser to your provider. Transcripts and summaries are cached _per episode_, so
once anyone generates one, everyone else gets it free and it doesn't count
against their quota.

**Enhanced audio degrades gracefully.** Skip-silence and volume boost need the
Web Audio API, which needs CORS-permissive audio hosts. Most large podcast hosts
send the right headers; some self-hosted feeds don't. When the audio graph can't
attach, playback and variable speed still work and only the enhancement
disables, with a note explaining why.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:push` | Push the schema straight to the database |
| `npm run db:studio` | Drizzle Studio |
| `npm test` | Vitest |

**Production builds use webpack, not Turbopack.** Serwist (the service worker
toolchain) is a webpack plugin, so `npm run build` passes `--webpack`. Dev still
runs on Turbopack — the service worker is disabled there anyway, since one left
running in development caches hard enough to make code changes look like they
never applied.

## Known advisories

`npm audit` reports issues in `eslint-config-next`'s plugin tree and
`drizzle-kit`'s bundled esbuild. Both are dev-only and neither reaches the
production bundle; `npm audit fix --force` would downgrade them to years-old
breaking versions, which is worse. Revisit when upstream updates.
