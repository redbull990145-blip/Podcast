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
| 4 | Recommendations, power mode, audio enhancements, PWA | ✅ Done |

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

## Deploying

Import the repo on Vercel. Two things are not the defaults:

- **Build command** must be `next build --webpack` (already the `build` script,
  so leaving it on "npm run build" is correct — just don't let Vercel override
  it with a bare `next build`).
- **Environment variables** — everything in `.env.example` that isn't optional.
  `API_KEY_ENCRYPTION_SECRET` must be the same value across deployments or
  stored BYOK keys become undecryptable; generate it once with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

Then add two repository secrets on GitHub, `SUPABASE_URL` and
`SUPABASE_ANON_KEY`, or the keepalive workflow silently skips and a free
Supabase project will pause after seven idle days.

### Free-tier ceilings worth knowing

| Limit | Value | What hits it first |
| --- | --- | --- |
| Groq audio-seconds/hour | 7,200 | One 75-minute episode is ~4,500 of them, shared across *all* users of the deployment |
| Vercel function duration | 60s | Transcribing a very long episode; the job stops early with an explanation rather than a 502 |
| Supabase idle pause | 7 days | Handled by the keepalive workflow |

The audio-seconds ceiling is the real constraint on transcription, and it is
per-organisation rather than per-user. Adding a personal Groq key in Settings
bypasses it entirely, which is what the in-app rate-limit message suggests.

## Design notes

**Nothing is paywalled.** Power-user mode is a UI density toggle, not an upgrade
prompt. OPML export sits in plain sight in Settings.

**AI works without a key.** Summaries, chapters and episode Q&A run on the
operator's own API keys with a modest daily per-user quota. Adding your own key
in Settings removes the quota. Both tiers execute server-side in this app's own
API routes — a user key is decrypted in memory for one call and never reaches
the browser. Transcripts and summaries are cached _per episode_, so once anyone
generates one, everyone else gets it free and it doesn't count against their
quota.

**Long episodes are transcribed in pieces.** Whisper providers cap a single
upload (Groq's free tier at 25MB), which an hour-long show already exceeds. The
audio is range-fetched in ~20MB chunks and the per-chunk timings are stitched
back onto one timeline. The first chunk has its ID3 tag and Xing header
stripped first — a truncated file whose header still claims the full duration
makes providers hang for two minutes and then fail, while billing the whole
episode against the hourly allowance.

**Enhanced audio degrades gracefully.** Skip-silence and volume boost route
playback through the Web Audio API, which only yields samples when the host
allows cross-origin reads — and many large hosts, Anchor/Spotify among them,
send no CORS headers at all. Connecting an element to an AudioContext is also
irreversible: feed it a non-CORS host afterwards and it outputs silence
permanently. So each host's CORS behaviour is cached, the choice of audio
element is made synchronously at play time, and an unknown host simply plays
normally the first time. Plain playback and variable speed are never put at
risk by an enhancement.

**Recommendations explain themselves.** Ranking is cosine similarity over
IDF-weighted category vectors built from your own listening history, computed
in one request with no model involved. Every card shows the actual top
contributors to its score, so the explanation is derived from the ranking
rather than written to justify it. Popularity only ever breaks a tie.

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
