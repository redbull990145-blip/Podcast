# Cue

A podcast platform for **web and Android**, built as a monorepo around one
shared core.

It's an **aggregator**, not a host: you subscribe to shows by RSS and audio
streams straight from each publisher. We never store or proxy audio, which is
what keeps running costs at roughly zero and means the catalog is real from day
one.

## Layout

```
apps/
  web        Next.js (App Router) · Tailwind · motion/react
  mobile     Expo · Expo Router · Reanimated · expo-audio    (Android)
  api        Fastify · Drizzle · Redis
packages/
  core       Domain logic — no platform imports. Player machine, queue, sync.
  types      Shared domain + API contract types
  validation Zod schemas, used by the API and both clients
  api-client Typed client + TanStack Query keys
  db         Drizzle schema and migrations
  design     Design tokens → CSS variables (web) and a JS theme (native)
  motion     Springs, easings, durations, gesture thresholds
  config     Shared tsconfig / eslint / vitest
```

**There is no shared UI component package, on purpose.** Universal component
libraries render mediocre web *and* mediocre native. What's shared is tokens,
types, validation and logic; what isn't is components, so each platform can use
its own idioms. The design system stays coherent because both sides read the
same token file.

## Getting started

No accounts, no Docker, no database to provision:

```bash
npm install
```

```bash
printf 'DATABASE_URL=pglite://.pglite-dev\nNEXT_PUBLIC_API_URL=http://localhost:8080\n' > .env
```

`pglite://` runs Postgres in-process against a local directory. It applies its
own migrations on first boot, so there is nothing to set up. Fill it with real
podcasts:

```bash
npm run seed -w @cue/api
```

That ingests five real feeds — about 5,000 episodes, including one show large
enough to prove pagination. Then:

```bash
npm run dev
```

Web is on `:3000`, the API on `:8080`.

> **Stop the API before seeding.** A PGlite data directory takes one writer.
> While `npm run dev` holds `.pglite-dev`, another process writing to it does
> not fail loudly — the API simply never sees the change, which looks exactly
> like a broken query. Real Postgres has no such limit; this applies only to
> the local dev database.

### Running the Android app

`localhost` on a phone means the phone. Point the app at your machine's LAN
address — the API already binds `0.0.0.0`, and prints its LAN URL on startup:

```bash
echo "EXPO_PUBLIC_API_URL=http://192.168.1.10:8080" >> .env
```

```bash
npm run dev -w @cue/mobile
```

Expo Router's `typedRoutes` is deliberately **off**. It types `Href` from a file
it generates into `.expo/`, which is both gitignored and only written by a
running dev server — so a clean checkout has no such file and every
`router.push` fails to typecheck. That is precisely what CI is. It also
mis-resolved in this monorepo, generating routes for `apps/web`'s pages
alongside the Android app's own.

### Moving to a real database

Set `DATABASE_URL` to a Supabase connection string and apply the migrations.
`pglite:` is rejected outright in production — it is a file on an ephemeral
disk, so it would silently discard everything on the next deploy.

```bash
npm run db:migrate -w @cue/db
```

Search and trending additionally need `PODCASTINDEX_KEY` and
`PODCASTINDEX_SECRET` (free). Without them every other feature still works;
search returns a clear "not configured" error rather than failing obscurely.
See `.env.example` for where each value comes from.

## Scripts

Everything runs through Turborepo from the repo root.

| Command | Does |
| --- | --- |
| `npm run dev` | All apps in watch mode |
| `npm run build` | Production build of every app |
| `npm run typecheck` | `tsc --noEmit` across the workspace |
| `npm run lint` | ESLint across the workspace |
| `npm test` | Vitest across the workspace |
| `npm run check` | typecheck + lint + test — run before committing |

### Why `@cue/mobile` has no test suite

Deliberate, not an omission. Everything in the Android app that *could* have a
unit test has been moved out of it: the queue, resume rules and sleep timer live
in `@cue/core`, and so does the trickiest part of the audio adapter — turning
`expo-audio`'s status snapshots into engine events (`player/status.ts`). That
edge detection is where the bugs with device-only symptoms live: a missed
`ended` and the queue never advances; a stall reported per tick and a
two-second buffer floods the UI. It is tested in core, off-device, in
milliseconds.

What is left in `apps/mobile` is screens and native bindings, which a test
runner can only check by re-describing them. Adding `jest-expo` to assert that
would cost a second test framework and buy nothing that `expo export` (which
proves the whole app bundles) and a real device do not already cover.

**Two things only a device can confirm**, and they are the two that matter most
on Android — that audio survives the screen locking past the ~3 minute
background cutoff, and that the notification controls work:

```bash
npx expo start --android
```

## Conventions

- **React is pinned to one exact version workspace-wide**, via `overrides` in
  the root `package.json`. Two copies of React in a React Native bundle is a
  fatal and completely silent failure: Metro resolves `apps/mobile/node_modules`
  first for the app's own files, but walks up to the hoisted root for anything
  hoisted — `react-native` and `@tanstack/react-query` both live there. A
  version skew therefore puts the query hooks on a different React than the
  components calling them, and every hook throws.

  `npx expo install --check` will report react as outdated. **That warning is
  expected and is being ignored deliberately.** It compares against Expo's
  pinned recommendation (19.2.3), not against a real constraint: React Native
  0.86.2 declares `"react": "^19.2.3"`, which 19.2.8 satisfies, and Expo itself
  declares `"react": "*"`. Taking Expo's pin would force a second copy, because
  `better-auth` pulls React in as a peer of `@cue/api` and holds the root at
  19.2.8 — trading a cosmetic warning for a broken app. Every *other* package
  the check flags should still be fixed with `npx expo install --fix`.
- **No `latest` in a dependency range.** An Expo app needs versions that match
  its SDK; `latest` silently drifted `react-native-gesture-handler` a whole
  major version ahead of what SDK 57 supports.
- **Units live in identifiers.** `durationSec`, `startMs`. Audio code mixes
  seconds and milliseconds constantly and the bugs are invisible until
  something is 1000× off.
- **Times crossing the wire are ISO strings**, not `Date`. JSON has no Date,
  and a type claiming otherwise after `JSON.parse` is lying.
- **No animation values in components.** Import from `@cue/motion`. Five spring
  presets, four durations, four easings — that's the whole vocabulary.
- **Opacity is tweened, never sprung.** Spring overshoot past 1 gets clamped
  and reads as a flicker.
- **No React state updates from rAF, scroll, or playback ticks.** Drive those
  through a `MotionValue` (web) or `SharedValue` (native) instead.
