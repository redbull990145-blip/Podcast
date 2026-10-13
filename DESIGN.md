# Design

The visual system as built. Product truth lives in [PRODUCT.md](PRODUCT.md).

## The one idea

**The chrome is warm paper; the artwork supplies the colour.**

This is how the product is colourful without being loud, and without inventing
a palette of its own. Every show carries a tint extracted from its own cover, so
a library of ten shows reads as ten colours while the interface itself stays
quiet. It also means the product never fights the artwork — the thing users
actually recognise.

The refused alternative: a UI with its own brand colour applied everywhere,
which turns every show into the same show.

**Paper, not graphite.** The ramp used to be cool graphite, `#08080A` to
`#FFFFFF`. It was neutral in the sense of having no opinion, and that turned out
to be the problem: podcast artwork is overwhelmingly warm, and a cool ground
behind a warm cover makes the cover read as slightly sour. The ramp is now warm
— `#0A0907` to `#FFFFFF`, leaning amber-brown the whole way — and the light
theme's ground is `#FBFAF7` rather than white, which gives light mode somewhere
to be that is not the top of the scale.

## Colour

Strategy: **restrained chrome + content-derived accent**. Tokens live in
`packages/design/src/tokens/color.ts` and are emitted to CSS variables by
`npm run tokens -w @cue/web`. Never hand-edit `apps/web/app/tokens.css`.

- **Paper ramp** — the entire interface. Warm, `#0A0907` to `#FFFFFF`.
- **Ember** (`#F0724A` dark / `#DC5A34` light) — the accent. It marks *what is
  live*: what is playing, what is new, which page you are on, and the editorial
  voice (the eyebrow over the resume hero, the rank in a trending list). Never a
  primary button — see below.

  **Not the scrubber's fill, which this used to claim.** The transport is drawn
  in ink for the reason the primary-button rule gives: an orange disc beside an
  orange progress bar is two saturated shapes on one strip competing to be
  looked at. The code has always been right about this and the document was not.
  The one progress fill that *is* coloured is the listening mark on a cover,
  and it takes the artwork's tint rather than the accent — it belongs to that
  show.
- **Ink** (`ink` / `textOnInk`) — the maximum-contrast fill. Primary buttons.
- **Artwork tint** — per show, derived at render from `podcast.accentColor`.

**Dark is still the default** — listening happens in the dark and in transit,
and artwork sits better on a dark ground — but it is no longer the only thing on
offer. There is a toggle in the sidebar, and no stored choice means *follow the
system*, which is what the `prefers-color-scheme` block in the generated
stylesheet already did on its own. The only people the old rule actually
excluded were those who wanted a light app on a dark machine, and the product
had no reason to have an opinion about that.

### One accent, and what it is allowed to mean

The previous palette spent the accent on exactly two things — the playing state
and the focus ring — and everything else was greyscale. That was a defensible
rule and it produced a defensibly dull product: on any screen where nothing was
playing there was no colour at all except the artwork, and the artwork on Home
is thumbnails.

The rule now is *live*, not *playing*: the accent marks the things that are
happening, which includes what is new since you last looked and where you
currently are. In practice that is a handful of very small marks — an eyebrow,
a rank, a six-pixel dot, a progress fill, one word in the sidebar — and their
smallness is the point. Widening what a colour is allowed to mean only stays
safe if you do not also widen how much of it there is.

**The sidebar's current page is a coloured word, not a filled pill.** A rail
that paints a block behind the active row makes the chrome the
highest-contrast shape on screen, competing with the covers it exists to frame.
Inactive rows sit at full text colour rather than greyed out, because they are
destinations rather than disabled controls — the hierarchy there is hue, not
opacity.

### Primary actions are ink, not accent

The most-pressed control in the product — Resume, Follow, Sign in — is a
near-black pill in the light theme and a near-white one in the dark. It is not
orange.

This is the most consequential rule in the palette, and it follows from the
accent meaning one thing. If the accent marks *what is playing*, then painting
every primary button with it puts the one signal that carries information in the
same colour as five that do not — and on the player bar it puts an orange disc
directly beside an orange progress fill, two saturated shapes on one 84px strip
competing to be looked at. What a primary action needs is weight, and ink has
more of it than any hue does.

`ink` and `textOnInk` are `textPrimary` and `bg` by value, and they are named
anyway: `background: var(--color-text-primary)` reads as a mistake at every call
site, and the pair would otherwise have to be spelled out again on native.

The exception is a control that belongs to one show, where an artwork-derived
`tint` still wins — there the colour *is* the information.

### Pills do things; panels hold things

Every control is `radius-full`. Every container is a panel with a modest corner.
That is the whole shape vocabulary, and it means a reader can tell a button from
a card without reading either. The radius scale came down to make it legible —
`md` 10 → 8, `lg` 14 → 12, `xl` 20 → 16 — because with three near-round steps in
play the pills had stopped being the round thing on screen.

### How the tint works

1. **Extracted once, server-side, at ingest** (`apps/api/src/feed/artwork-color.ts`).
   Podcast artwork comes from arbitrary CDNs with no CORS headers, so a browser
   canvas cannot read its pixels at all — and doing it per-device would repeat
   the work on every phone. One extraction feeds web and Android.
2. **Dominant, not average.** Averaging a cover gives mud; every image with a
   bright subject on a dark ground averages to grey-brown. Pixels are ranked by
   area × saturation, because a cover that is 70% black and 30% orange is an
   orange cover to everyone who looks at it.
3. **Re-fitted per surface** via `deriveTint()` in `packages/design`. Only the
   *hue* survives; lightness and chroma are re-set in OKLab to the surface.
   A raw cover colour is as likely to be fluorescent lime or near-black as not.

`deriveTint` returns three roles:

| Role | Use | Constraint |
| --- | --- | --- |
| `wash` | ambient gradient behind a header, row hover | contrast < 2:1 against the background — felt, not seen |
| `fill` | a tinted button or chip | strong enough to read as a control |
| `text` | tinted text and icons | **≥ 4.5:1 against the theme background, always** |

**A fourth use, added later: the listening mark.** A part-heard episode carries
a three-pixel bar along the bottom edge of its own cover and a finished one is
dimmed under a tick, both drawn in `text`. It is the only place a *quantity* is
expressed in an artwork colour, and it earns that by being the one fact a show
page could not previously state at all — which of three hundred episodes you
have heard. The signal is never the colour alone: the bar has a length, the tick
has a shape, and the finished cover loses contrast.

That last row is enforced by tests, not by eye
(`packages/design/src/tokens/tint.test.ts`) — the inputs are covers we do not
control, so legibility has to hold by construction. A greyscale cover returns
no tint rather than being given an invented hue.

### The palette is held to AA by test too

`contrast.test.ts` checks every text role against every surface it can land on,
in both themes, plus both fill/label pairs and the control border. This is not
belt-and-braces: a token is edited once, by hand, and silently changes the
contrast of every screen that uses it. What the repaint had to move because of
the test rather than because of taste:

- **The light theme's accent is a different orange from the dark theme's.**
  `#F0724A` reaches 6.3:1 on the dark ground and 2.8:1 on the light one, which
  fails SC 1.4.11 for a mark that has to be visible without a label. Light takes
  `#DC5A34`. Same reason the previous palette carried two ambers.
- **`textTertiary` is pinned by the *darkest* light surface, not the lightest.**
  Light `surface` is `#F5F1E8` — a recess, darker than the page — so dark text
  has *less* contrast on a card than on the ground. The role sits at `#726B64`,
  two steps darker than the source design's `#8A827A`, which came in at 4.08:1
  there.
- **The label on ember is dark in both themes.** Ember is a light hue; white on
  it reaches 3.6:1, a fail on a control anyone might press.
- **`borderStrong` is a veil, not a ramp step.** It is the edge of a secondary
  button and the unfilled half of the progress track, so SC 1.4.11 asks 3:1 of
  it. The warm hairline the design uses for `--border` is nowhere near that, so
  `border` keeps that value for decorative separation and `borderStrong` is a
  40% (dark) / 50% (light) wash of the text colour over the ground.

## Typography

- **Geist** for the interface. Flat terminals, very even colour, and numerals
  that hold their width — which is what a screen full of durations actually
  needs.
- **Geist Mono** for timecodes, and only for timecodes. Elapsed and remaining
  times are read as *positions*; in a proportional face `1:04:22` is a different
  width from `1:14:22`, so the numbers shuffle sideways while the audio plays.
  `tabular-nums` fixes the digits and not the colons, and it cannot make a
  timecode look like a different kind of thing from the sentence beside it.
- **Non-Latin scripts fall through to the platform, and always did.** Geist
  ships Latin, Latin-Extended, Cyrillic and Vietnamese — not Devanagari, not
  Arabic, not CJK. A browser resolves a font stack per *codepoint*, so a Hindi
  show title inside an otherwise-Geist page lands on the system UI face on the
  same line, with no branching anywhere in the app.

  This is worth stating plainly because the previous note here claimed Inter
  was carrying those scripts and it was not: Inter was loaded with the `latin`
  and `latin-ext` subsets, and Google serves no Devanagari or Arabic cut of it
  in any case. Hindi and Arabic readers saw their system font before this
  repaint and see it after. Keeping Inter as a second webfont would have added
  a family to every page load in order to cover Greek, which this app does not
  ship — so it went, and the platform stack is named explicitly instead.

Scale in `packages/design/src/tokens/typography.ts`, applied through
`.type-*` classes. Tracking tightens as size grows (optical sizing by hand);
this is the single biggest difference between typography that looks designed
and typography that looks defaulted.

**The top of the scale came down.** `display` was 40px bold and is now 34px
semibold. 40px bold at the head of every screen was announcing the tab you had
just pressed — the size was doing the work a *sentence* should do. At 34 it is
still unmistakably the page title and it stops shouting the word "Library" at
someone who chose Library.

`font-variant-numeric: tabular-nums` globally — timestamps and durations sit in
columns and must not jitter as digits change.

`.type-hero` is the one type token with a breakpoint inside it: the resume
hero's title is a row title on a phone and a page title on a desktop. It is a
media query rather than `class="type-title3 md:type-display"`, which looks like
it would work and cannot — two rules setting `font-size` at the same
specificity are resolved by their order in the stylesheet, not by the order they
appear in the markup.

## Layout and depth

4px spacing grid. Radii are modest and **artwork radius scales with rendered
size** (`radiusForArtwork`): a 44px thumbnail at 16px radius is a blob; a 320px
cover at 6px is a sticker.

**Depth runs opposite ways in the two themes.** In dark mode a surface above
another surface is *lighter* — shadows on near-black are nearly invisible and
only cost paint time. In light mode it is the resting surface that is *darker*
than the page: light `bg` is `#FBFAF7` and light `surface` is `#F5F1E8`, so a
card is a recess. Raising every surface toward white instead is what made the
old light theme read as a spreadsheet. Shadows stay reserved for genuinely
floating things, and they are wide and soft with a negative spread rather than
tight and dark — a hard shadow on warm paper looks like a sticker.

`measure.sidebar` (260px) is a token rather than three copies of a number: the
rail, the content gutter that clears it, and the player bar all have to agree,
because the mini artwork starts where the rail ends so that it lines up with the
page's first column instead of floating in the gutter.

## Motion

Tokens in `packages/motion`, shared verbatim by both platforms (Motion for React
and Reanimated take the same `stiffness/damping/mass`).

- Five springs — `gentle`, `standard`, `responsive`, `snappy`, `expressive`.
- **Opacity is tweened, never sprung.** Spring overshoot past 1 gets clamped and
  reads as a flicker.
- Ceiling of 320ms. Anything slower stops reading as feedback and starts
  reading as a wait.
- **Reduced motion reduces, it does not remove.** Travel and springiness go;
  every state change stays visible.

Authored moments, not scattered effects: a 60ms button press-scale, a 200ms
row-tint reveal on approach, a 200ms artwork fade over its own placeholder.

### The tokens reach the stylesheet, not just the components

`@cue/motion` emits `--duration-*` and `--ease-*` alongside the design tokens,
and `@theme` points Tailwind's transition defaults at them. A bare
`transition-colors` therefore resolves to 100ms on the standard curve with no
duration class at all. Tailwind's own four easings are cleared
(`--ease-*: initial`) so the app has exactly the four the token file defines —
that is the enforcement, not the tidiness. With `ease-out` still reachable a
component can invent a fifth curve and nobody notices.

### Reduced motion is a JS decision, not only a media query

Motion for React writes `transform` as an inline style, and an inline style
outranks a class rule even inside `@media (prefers-reduced-motion)`. A
stylesheet block therefore cannot touch the player's expansion, the travelling
artwork, or any press-squash. Those read the preference through
`apps/web/lib/motion.ts`, which translates the shared policy in
`@cue/motion/reduced.ts`. The stylesheet block remains as a backstop for CSS
animation only.

What that policy actually says:

- **Travel is replaced, never shortened.** Half a slide is still a slide. The
  player arrives at its destination and crossfades there; the drag gesture is
  withdrawn entirely, because dragging *is* travel — the mini bar and the grab
  handle already open and close it, so no capability is lost with the motion.
- **Press feedback survives.** Reduced motion caps the squash at 4% rather than
  removing it. On a touch screen it is the only thing that answers "did that
  land?" — there is no cursor and no hover state to answer first.
- **Loops become opacity.** The buffering ring breathes in place instead of
  rotating. Leaving it static would read as a rendering fault; a spinner frozen
  mid-turn is the shape of a bug.

## Discovery

**Home leads with what you were already doing.** A catalogue grid answers "what
exists", and almost nobody opens a podcast app asking that — they open it part
way through something. So the first thing on Home is the episode in progress,
and the catalogue is what follows it.

**Not a wall of carousels**, which is the default shape for this screen and the
reason most of them are unreadable. Rails give every item identical framing,
which throws away the ranking the data already did and asks the reader to redo
it by swiping. Instead the most recently touched episode gets a card and the
rest get rows — the hierarchy *is* the recommendation. The section is absent
entirely when nothing is in progress; a header over an empty rail is chrome
advertising a feature you have not reached.

**An empty search box is a screen, not a prompt.** A search screen that waits
to be told what to do is a dead end for anyone who does not already know what
they want, which is most people opening a directory. The resting state is the
catalogue's own shape — its categories, with real counts — next to what the
directory says is rising.

**Browsing is Cue's catalogue; searching is the whole directory.** These are
two different questions and the screen answers them in two different places on
purpose. A category tile can only count shows that have actually been ingested,
so it opens onto something real; search reaches upstream, where nothing has an
id until its feed has been read.

**A category wears a colour borrowed from a show inside it.** It is the one
thing on the browse screen with no artwork of its own, and inventing a palette
for the tiles is exactly the shortcut that would make it the only page in the
app carrying colours the catalogue did not supply. `deriveCover()` takes the
`accentColor` of a show in that category and returns two stops of the same hue,
both dark enough for the white label — measured, not assumed, because at a
fixed lightness a mustard is far more luminous than a navy and would fail
silently on whichever tile happened to exist that week. The mock's own tiles
(`#EAE3D8 → #8A6E4E`, white text) do not clear AA; these do, and
`tint.test.ts` checks all twenty-four hues around the wheel.

**Four tiles, then a list.** The same move Home makes with what is in progress:
the hierarchy is the recommendation. Four across the top and a quiet list of
counts underneath reads in one glance; twelve tiles is a wall nobody scans.

**A directory result is a control, not a link.** Search results come from
upstream and are not in our database, so they have no id and nothing to link
to. Choosing one ingests the feed, and *that* is what gives the show an id — so
the whole row is the button and the navigation happens after the ingest. The
row says "Add" for the same reason: without it, it reads as a link to a page
that does not exist yet.

**Languages are labelled in their own script** — हिन्दी, not "Hindi". Someone
scanning for Hindi shows finds it faster, and a picker that names every
language in one language is the clearest possible sign of who it was built for.

## Composition rules held

- **A section header is a heading, not a rule.** It used to be an 11px
  uppercase label with a hairline running off to the right of it. The line gave
  every section a visible top edge and also gave every section the same weight
  as every other, because an 11px label carries none of its own — Home read as
  five equally important strips whichever one mattered. It is now a 20px
  heading with the note underneath it, which does the same structural job by
  being legible from a scroll.
- **One eyebrow, and it is the accent one.** "Pick up where you left off", set
  in ember above the resume hero, is the exception to the no-kicker rule and it
  earns it by being the one place the accent is spent on text — marking the
  section that is about what is playing, which is the only thing the accent
  means anywhere else.
- **Cards are for peers in a scroller, and nowhere else.** The "Also in
  progress" cards have an edge because a swipe has to land somewhere. The
  Library is grouped lists; the home grid is artwork with text beneath, no card
  chrome.
- Artwork-led, typography-led. Colour arrives from content, never from
  decoration.
- Empty states teach rather than apologise, and distinguish *signed-out* from
  *signed-in-with-nothing* — they are different problems with different fixes.

## Screens

**Home leads with a hero, not a card.** The episode you touched most recently
gets a 220px cover, its title at page-title size, and the two controls that
actually apply to a half-finished episode — Resume, and Start over. The rest of
what is in progress gets cards a third of that size. The hierarchy *is* the
recommendation, and Start over is there because a half-finished episode is the
one case where "play" is genuinely ambiguous and the answer the button gives is
wrong often enough to need a visible alternative.

**The player is a dialog, and says so.** The expanded sheet scrims the page,
locks the document's scroll and closes on Escape — and for a long time said none
of that to a keyboard or a screen reader. Collapsed, it is translated off the
bottom of the window at `opacity: 0`, which removes it from neither the tab
order nor the accessibility tree: measured on a 1440px window with an episode
playing, it held 662 focusable elements nobody could see, a complete second
transport plus every line of a 651-cue transcript. `inert` on the closed sheet
deletes those; `inert` on the rail, the page and the tab bar while it is open is
what makes the sheet actually modal; and `useModalSheet` moves focus in, keeps
it in, and returns it on close.

The caption column was gated on the same mistake. `panelChoice` resolves to
`'captions'` at any width past 1024, so the whole sweep — a per-frame paint
loop, a scroll spring, a React write per spoken line — ran behind a *closed*
player on every desktop. It is mounted with the sheet now.

**Sleep timer.** The machine has always had one: a wall-clock deadline rather
than a countdown, because a JS timer drifts exactly when a sleep timer is
running. What it never had was a control. It is a crescent in the expanded
player's utility row, showing the minutes remaining beside it while armed, with
the options revealed in place — the same disclosure `CaptionSync` uses in the
column beside it rather than a second portalled menu.

**Space, J/K/L, arrows, M.** Bound globally rather than on the player, because
the player is a bar at the floor of the window that most people never focus.
Every binding maps onto an action the store already exposes, and every one
defers to a focused control: a button that has focus owns its own Space.

**The desktop player bar is the player.** 84px, three columns — what is playing,
the transport with its scrubber and timecodes, then speed, queue and volume —
which is the shape every desktop media player has had for twenty years, because
that is where people's eyes already go. Expanding is still there, for the cover
and the transcript; it is no longer the only way to skip back fifteen seconds.
On a phone the same element stays a 72px strip you press to open the real thing,
because five controls and a scrubber do not fit across 390px. One element rather
than two, so the artwork keeps travelling continuously out of it and the drag
gesture works at both widths.

**Home greets a listener and pitches a stranger.** Signed out, the masthead is
"Listen" and one sentence saying the audio comes from the publishers themselves
and nothing is asked before you press play — the two facts that decide whether
someone stays. Signed in, it is the date and your name, and the pitch goes:
keeping it above the resume hero for someone who has used the app for a month
is the app talking to itself. Both halves are client-rendered, which is a trade
rather than an oversight — Home is cached for five minutes and shared by
everyone, so a greeting cannot come from the server without either making the
page per-request or handing one listener's name to the next, and the date is
the *reader's* date, which a server in another timezone will confidently get
wrong.

**Three episodes presented large, not six in a list.** The catalogue grid
already answers "what else is there", at thumbnail size, for the whole library;
repeating that question in slightly bigger rows immediately above it was two
surveys stacked on each other. What the section is for is making three specific
episodes look worth an hour of someone's evening, and that takes a cover you
can see. The first column is wider than the other two, because three equal
columns is a table and the eye has to be told where to start.

**The sidebar carries the shows themselves**, under the four destinations. Not a
fifth destination — Library is still where you go to manage them — but following
a show should put it somewhere visible from every screen rather than only from
the one page that knows about it. A dot rather than a count: the number is on
the Library row where there is room to read it, and here it only has to answer
"is there anything?".

**A show page says what you have heard.** The plainest gap the product had: an
archive of three hundred episodes with no mark on any of them. It is one request
per page rather than one per row — `GET /me/progress?ids=` — and deliberately
not a field on the episode list, which runs behind a shared cache that per-user
data would either poison or defeat.

**Library** is organised by the listener's relationship to each show — *Waiting
for you* / *Still going* / *Gone quiet* — not by the catalogue's alphabet. You
already know what you subscribed to; what you want on opening is what is waiting.
Empty groups are dropped rather than rendered as empty headings.

### On the phone

The token layer carries the repaint to Android without a line of native code —
the palette, the type scale and the radii are one definition read by both
platforms. What is *not* shared is composition, and these are the places the
phone had to be laid out rather than recoloured:

- **The resume hero is a band, not a card.** Full width, edge to edge, hairline
  top and bottom. An inset card with rounded corners spends thirty points of a
  390px screen on decorating the one item that least needs help being found.
- **The runners-up are a horizontal rail**, and it is the only rail in the
  product. DESIGN.md's objection to carousels is that they give every item
  identical framing and throw away the ranking the data already did — which is
  precisely why these are *below* a hero rather than beside each other. They
  are genuine peers, there are at most three, and three cards do not fit across
  a phone at any readable size. Snap points, so a swipe lands on a card.
- **The mini player sits *on* the tab bar, flush.** It was an inset card with
  its own border, which put two stacked floating objects at the bottom of every
  screen with a stripe of scrolling list visible between them — the one part of
  the layout where nothing should be moving.
- **Geist does not load on native.** Expo would need the font as a bundled
  asset and a load gate before first paint; the phone reads the same sizes,
  weights and tracking in the platform's own face. Timecodes lose the mono
  cut there, which is why `tabular-nums` stays on globally rather than being
  replaced by the font choice.

**Auth** lives in its own route group without the app shell. A sidebar full of
destinations you cannot use yet is noise at the one moment the screen should ask
exactly one thing.
