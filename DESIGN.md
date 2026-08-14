# Design

The visual system as built. Product truth lives in [PRODUCT.md](PRODUCT.md).

## The one idea

**The chrome is near-neutral graphite; the artwork supplies the colour.**

This is how the product is colourful without being loud, and without inventing
a palette of its own. Every show carries a tint extracted from its own cover, so
a library of ten shows reads as ten colours while the interface itself stays
quiet. It also means the product never fights the artwork — the thing users
actually recognise.

The refused alternative: a UI with its own brand colour applied everywhere,
which turns every show into the same show.

## Colour

Strategy: **restrained chrome + content-derived accent**. Tokens live in
`packages/design/src/tokens/color.ts` and are emitted to CSS variables by
`npm run tokens -w @cue/web`. Never hand-edit `apps/web/app/tokens.css`.

- **Graphite ramp** — the entire interface. Cool-leaning, `#08080A` to `#FFFFFF`.
- **Amber** (`#DE9A3F` dark / `#BE7C28` light) — the *functional* accent only:
  focus rings, the playing state, primary actions with no artwork context.
- **Artwork tint** — per show, derived at render from `podcast.accentColor`.

**Dark is the default**, not a toggle preference: listening happens in the dark
and in transit, and artwork sits better on a dark ground.

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

That last row is enforced by tests, not by eye
(`packages/design/src/tokens/tint.test.ts`) — the inputs are covers we do not
control, so legibility has to hold by construction. A greyscale cover returns
no tint rather than being given an invented hue.

### The palette is held to AA by test too

`contrast.test.ts` checks every text role against every surface it can land on,
in both themes, plus the accent label and the control border. This is not
belt-and-braces: a token is edited once, by hand, and silently changes the
contrast of every screen that uses it. Four things it caught and forced:

- **`textTertiary` failed on every surface, in both themes** — the role worn by
  timestamps, durations and metadata. Fixing it needed two new ramp steps
  (`350`, `450`); snapping to an existing one would have made tertiary
  identical to secondary and collapsed two roles into one.
- **A white label on the light-theme amber was 3.44:1** — the primary button,
  the most-pressed control in the product. Amber is a light hue and wants a dark
  label; it now reads the same way in both themes.
- **`borderStrong` was ~1.4:1 in both themes.** It is the edge of a secondary
  button and the unfilled half of the progress track, so SC 1.4.11 asks 3:1 of
  it. This is the one change that visibly costs airiness — that boundary used to
  be a hairline and is now a line you can actually see.
- **Two status colours sat at 4.47 and 4.49.** Close enough to look fine and
  still be a fail, which is precisely why it is a test and not a judgement.

## Typography

- **Inter** for UI. Widest script coverage of any free sans, which matters
  because this has to render Hindi, Arabic, Japanese and Korean.
- **Instrument Serif** for display only — page titles and editorial headings.
  Never body copy. It is what keeps the product from reading as a dashboard.

Scale in `packages/design/src/tokens/typography.ts`, applied through
`.type-*` classes. Tracking tightens as size grows (optical sizing by hand);
this is the single biggest difference between typography that looks designed
and typography that looks defaulted.

`font-variant-numeric: tabular-nums` globally — timestamps and durations sit in
columns and must not jitter as digits change.

## Layout and depth

4px spacing grid. Radii are modest and **artwork radius scales with rendered
size** (`radiusForArtwork`): a 44px thumbnail at 16px radius is a blob; a 320px
cover at 6px is a sticker.

In dark mode depth comes from surface lightness stepping up, not shadow —
shadows on near-black are nearly invisible and only cost paint time. Shadows are
reserved for genuinely floating things.

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

**An empty search box shows what is trending, not an instruction.** A search
screen that waits to be told what to do is a dead end for anyone who does not
already know what they want, which is most people opening a directory.

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

- **No eyebrow or kicker above a heading.** The heading carries its own weight;
  metadata sits below it.
- **No cards as page structure.** The Library is grouped lists; the home grid is
  artwork with text beneath, no card chrome.
- Artwork-led, typography-led. Colour arrives from content, never from
  decoration.
- Empty states teach rather than apologise, and distinguish *signed-out* from
  *signed-in-with-nothing* — they are different problems with different fixes.

## Screens

**Library** is organised by the listener's relationship to each show — *Waiting
for you* / *Still going* / *Gone quiet* — not by the catalogue's alphabet. You
already know what you subscribed to; what you want on opening is what is waiting.
Empty groups are dropped rather than rendered as empty headings.

**Auth** lives in its own route group without the app shell. A sidebar full of
destinations you cannot use yet is noise at the one moment the screen should ask
exactly one thing.
