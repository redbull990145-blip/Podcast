# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

Web (Next.js) and Android (Expo/React Native) from one monorepo. iOS is
explicitly out of scope — not built, not configured, not claimed. The two
platforms share tokens, types, validation and domain logic, but not components:
each uses its own idioms so interaction feels native rather than ported.

## Users

Strangers arriving with no context and no subscriptions. Someone who wants to
find a show, start listening, and come back to where they left off — possibly
on a different device.

The first-run case is the designed-for case: an empty Library must teach rather
than apologise, and search/discovery is the front door, not a secondary tab.

## Product Purpose

Discover, stream, and listen to podcasts. Cue is an **aggregator, not a host**:
users subscribe by RSS and audio streams directly from each publisher. Nothing
is stored or proxied, which keeps the catalogue real from day one and running
costs near zero.

Success is a listener who finds something, plays it without friction, and
resumes it later without thinking about where they left off.

## Positioning

Three commitments held together rather than traded off:

1. **Calm and editorial.** No autoplay walls, no engagement bait, no wall of
   card carousels. Content leads; chrome recedes.
2. **Genuinely fast.** Interaction latency is a product requirement, not a
   polish pass. Sustained 80–120Hz during scroll, player expansion and
   transcript scroll.
3. **Serious listening tools.** Transcripts, timestamped bookmarks, chapters,
   and search inside an episode — present for those who want them, invisible to
   those who don't.

## Operating Context

Listening happens in the dark, in transit, and in the background. The app is
dark-first, must survive network changes and interruptions, and must keep
playing while the UI is nowhere near the foreground.

Users arrive from a search engine or a shared link as often as from the home
screen, so public pages must render real content server-side.

## Capabilities and Constraints

- **Catalogue** comes from PodcastIndex plus direct RSS ingestion. Audio is
  never stored, transcoded, or proxied.
- **Auth** is email/password. Browsing, searching and playing are **anonymous**;
  signing in unlocks the personal library, subscriptions, and cross-device
  resume.
- **Free-tier infrastructure** throughout: Supabase Postgres, Upstash Redis,
  Vercel, Render/Koyeb. A local in-process Postgres runs the whole stack with
  no credentials.
- **AI** (transcription, summaries, chapters, ask-this-episode) runs on an
  operator key with a per-user daily quota; users may add their own key to
  bypass it. Not yet built.
- **Not built and not to be faked:** creator upload, hosting, analytics,
  comments, follows, collaborative playlists.

## Brand Commitments

Name: **Cue**.

Voice: plain, specific, unhurried. Never exclamatory, never salesy. Error text
says what happened and what to do about it.

## Evidence on Hand

Real seeded catalogue of ~5,400 episodes across five live feeds (The Daily,
Syntax, The Changelog, ShopTalk, Planet Money). Every screen is built against
real publisher data — real title lengths, missing durations, absent artwork,
3,000-episode back catalogues.

No testimonials, user counts, press, or partnerships exist. None may be
invented.

## Product Principles

1. **Never fake functionality.** No placeholder data standing in for a real
   model, no screen that looks finished but does nothing.
2. **Anonymous first.** Nothing that can work signed-out requires an account.
3. **Optimistic by default.** Like, save, subscribe and queue update instantly
   and reconcile after; failure reverts visibly rather than silently.
4. **Colour comes from content.** The chrome stays near-neutral and the
   artwork supplies the colour — the mechanism by which the product feels
   colourful without becoming loud.
5. **Motion must earn its place.** It communicates state, explains space,
   improves perceived responsiveness, clarifies a gesture, or it is removed.

## Accessibility & Inclusion

**WCAG 2.2 AA**, held as a requirement rather than an aspiration: contrast
ratios, full keyboard paths, visible focus, correct focus order, screen-reader
labelling, and honoured `prefers-reduced-motion`.

Reduced motion **reduces** rather than removes: travel and springiness go,
state changes stay visible.

Multilingual from the architecture up — English, Hindi, Spanish, French,
German, Portuguese, Japanese, Korean, Arabic — including RTL. No
language-specific logic hardcoded.
