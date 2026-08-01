# Plan 004 — Living Artwork: a real-time artwork animation engine

**Repo commit this plan was written against:** `30c1b1e`
**Status:** Approved — in implementation
**Scope:** New `lib/artwork/` domain + `components/artwork/` surface. Two new dependencies.

## Decisions taken

| Question | Decision |
| --- | --- |
| Renderer | ~~`three` + `@react-three/fiber`~~ → **direct WebGL2**. Reversed during implementation on evidence; see below. |
| Palette | **No Node Vibrant.** Extend the existing k-means extractor with swatch classification instead — no new dependency, no duplicated decode, nothing tested gets deleted. See §9.3 (revised). |
| Surfaces | **Now Playing only.** Player bar stays static; page heroes deferred past phase 7. |
| Default intensity | **`"medium"`.** |

### The brief changed: visible, not imperceptible

The original spec asked for motion "almost impossible to detect", and two rounds
of calibration delivered exactly that — and the answer, twice, was that nobody
could see anything at all. On review the requirement was restated: a **visible
colour band travelling across the artwork on a loop**, in every profile.

That is a different product, and it changes one of the design's load-bearing
constraints. Recorded plainly:

- A new `SHEEN` module is now the primary effect and is present in all sixteen
  animating profiles, weighted to each one's character (1.0 in Atmospheric
  Colour Flow and Ambient Light Sweep, 0.4 in the portrait profile, 0.3 in
  Quiet Luminance). It crosses the frame in about ten seconds.
- The fidelity clamp went from 0.012 → 0.07 → **0.3** in Oklab L. The engine no
  longer claims the artwork is unmodified in the strict sense the original brief
  demanded; it claims the modification is light falling across it.

What did **not** change, and still holds:

- `SHEEN` has no `displace` body, so it cannot move a pixel. Text, logos and
  faces brighten under the band; they never bend.
- Its chroma only ever moves toward `uVibrant`, a swatch extracted from that
  cover, so it cannot introduce a hue the artwork did not contain.
- The protection mask still gates the two displacing modules unchanged.

The loop is seamless because the band starts and ends off screen: the centre
sweeps −1.25 → +1.25 while the projected axis spans ±0.71, so at the moment
`fract()` wraps there is nothing on screen to jump.

### The first calibration was invisible, and why

Shipped, the engine rendered correctly and moved by about 0.008 in Oklab L —
two levels out of 255. Nobody could see it at any intensity. Two separate
mistakes, both found by measuring pixels rather than reasoning about them:

1. **The budget was set from a just-noticeable difference.** A JND describes two
   patches side by side *at the same instant*. This is the opposite task — a
   slow, low-spatial-frequency change spread over seconds, which is the least
   detectable stimulus the visual system handles. The threshold for it is
   several times higher.

2. **`fbm` returned 0.25–0.75, not 0–1.** Summed octaves cluster near their mean,
   so centring the raw sum gave excursions of ±0.15 while the modules were
   written as though they had ±0.5 — and the same coefficient was being applied
   to sines (±1), noise fields (±0.2) and `exp()` envelopes (0–1), making field
   modules roughly four times quieter than oscillator ones at equal weight.

Fixed by normalising `fbm`, splitting the coefficient into `L_SWING` (for
oscillators) and `L_FIELD` (for fields), and recalibrating against measured
peak-to-peak rather than against a JND.

Measured on a real cover, per-pixel peak-to-peak over 20s:

| intensity | mean | max | share of frame moving ≥4 levels |
| --- | --- | --- | --- |
| before, `expressive` | 2.6 | 11 | 25% |
| after, `medium` | **4.2** | 18 | 51% |
| after, `expressive` | **6.5** | 25 | 80% |

### The renderer decision was reversed, with evidence

R3F was built first, as chosen. It could not be made to hold a scene mounted.

`<Canvas>` renders its children into a *separate* reconciler root, from a layout
effect with **no dependency array**, behind an awaited async `configure()`. A
mount/unmount trace showed every render of the host mounting the scene and
unmounting it 2–7ms later, over and over, never settling — which cancelled the
texture load each time, so the engine never drew a frame. That survived:
memoising the host, making every prop referentially stable, moving playback
state onto a subscription so the canvas never re-rendered, and finally
**disabling React StrictMode entirely**. The mount/unmount pairs continued.

Swapping in a direct WebGL2 host fixed it immediately: 75fps sustained, the
pause ramp settling to zero, and the loop stopping completely when idle.

The architecture had anticipated this — §9.2 flagged the escape hatch and kept
the host thin for it. Nothing in `analysis/`, `profiles/` or `shaders/` changed
to make the swap; the GLSL is identical. What changed is two component files.

Measured side effects, all in the intended direction:

| | R3F | direct WebGL2 |
| --- | --- | --- |
| Lazy chunk | 229 KB gzipped | 0 — no library |
| Largest client chunk | 229 KB (three) | 61 KB (pre-existing app code) |
| Scene stability | mount/unmount every render | mounts once |
| Frame rate | never drew | 75fps sustained |

This reverses an explicit instruction, so it is flagged rather than buried. It is
reversible: restoring R3F means rewriting `components/artwork/artwork-canvas.tsx`
and re-adding the scene component, and nothing else.

---

## 0. What I found in the codebase first

Five findings changed the design. They are listed first because each one removes a
problem the naive version of this engine would have hit.

### 0.1 There is already a palette extractor, and it already solved the hardest problem

`lib/player/artwork-palette.ts` is a 400-line, tested, deterministic k-means colour
extractor. More importantly it solved the problem that would otherwise have killed
this whole feature:

> Podcast artwork lives on hosts we do not control and that mostly send no CORS
> headers.

For a 2D canvas that means a tainted canvas and a throwing `getImageData`. **For WebGL
it is worse: uploading a non-origin-clean image into a texture throws `SecurityError`
outright.** There is no tainted-but-renderable mode. A WebGL artwork engine that
naively does `new THREE.TextureLoader().load(episode.artworkUrl)` fails on the majority
of real feeds.

The existing module's fix is the fix for us too:

```ts
// lib/player/artwork-palette.ts
return `/_next/image?url=${encodeURIComponent(src)}&w=64&q=75`;
```

Routing through Next's own optimizer makes the bytes arrive **same-origin**, so the
texture is origin-clean and WebGL accepts it. This is load-bearing for the entire
engine and I would not have found it without reading that file.

Two constraints come with it, both already visible in `next.config.ts`:

- `w` must be a value in `imageSizes ∪ deviceSizes` = `{32,48,64,96,128,176,256} ∪ {640,828,1080}`. Anything else is a 400.
- `q` must be 75 to reuse the cache entry every other `<Image>` on the page already created.

**Design consequence:** the engine requests `w=640&q=75` for its texture — which is
*the exact URL Now Playing's `<Image width={640} sizes="…380px">` already fetched.*
The texture therefore comes out of the HTTP cache. **The animation engine costs zero
additional network bytes on the surface it ships to.** And `w=128&q=75` for analysis,
also a cache-friendly, already-permitted width.

### 0.2 This repo has already learned that reduced-motion needs a third mechanism

`plans/001` documents it precisely: `<MotionConfig reducedMotion="user">` only strips
transform/layout animation from *Motion* components, and the `@media (prefers-reduced-motion)`
block in `globals.css` only touches CSS `animation-duration`/`transition-duration`.
A custom JS animation loop falls through **both**.

A `requestAnimationFrame`-driven WebGL canvas falls through both by exactly the same
mechanism. So the engine reads `useReducedMotion()` directly and hard-stops — it does
not slow down, it renders one static frame and tears the loop down. This is written
into the plan rather than discovered later.

### 0.3 The perf conventions are strict and the engine must not violate them

`now-playing.tsx` splits `PositionBar` into its own component purely so the ~4Hz
position tick doesn't re-render the artwork. `captions-panel` is virtualised. Every
`usePlayer` read is selector-scoped.

**Design consequence:** the render loop never subscribes to the store through a hook.
It reads `usePlayer.getState()` inside `useFrame` and uses `usePlayer.subscribe()` for
discrete transitions (play/pause). React re-renders for this component are bounded at
roughly one per episode change. Uniform updates mutate `.value` in place; they never
go through props.

### 0.4 The Content-Security-Policy needs no changes

`next.config.ts` sets `frame-ancestors`, `object-src`, `base-uri`, `form-action` — and
deliberately no `script-src`, `img-src`, `worker-src`, or `default-src`. WebGL, canvas
readback, and (if we ever want it) a blob worker are all unrestricted. **No config
change required**, which is worth confirming explicitly because a `default-src`-based
CSP would have blocked a blob worker.

### 0.5 Tests run in `environment: "node"`

`vitest.config.ts` sets `environment: "node"` and includes `lib/**/*.test.ts`. And
`artwork-palette.ts` exports `paletteFromPixels(data: Uint8ClampedArray)` specifically
so the pure part is testable without a DOM.

**Design consequence:** every analysis metric is a pure function over a
`Uint8ClampedArray` in a separate file, with the DOM decode isolated in one place. The
existing file's shape is the template. Profile selection is likewise pure and fully
unit-testable — which matters a lot given "animation selection should NEVER be random".

---

## 1. The three hard requirements, and the mechanism that guarantees each

Most of this design exists to make three of your rules *structurally impossible to
violate*, rather than merely unlikely.

| Rule | Naive approach | Why it fails | Mechanism here |
| --- | --- | --- | --- |
| Never distort text / logos / typography | "keep the warp small" | A 2px warp on 11px type is still visibly mushy, and warp amplitude is uniform across the frame | **Protection mask** (§3.1) — displacement amplitude is multiplied by `1 − edgeDensity(uv)`. Text is by definition the highest-edge-density region in podcast art, so it protects itself. |
| Never modify / recreate the artwork | "use a low blend weight" | Blend weight is a knob someone will turn up; sRGB→linear→sRGB round-tripping alone shifts pixels | **Fidelity clamp** (§3.4) — the final line of the shader hard-clamps output to within ±Δ of the source sample in Oklab. Deviation is bounded by the compiler, not by discipline. |
| No visible loop, no repetitive pattern | `sin(t * speed)` | Any finite set of rational-ratio frequencies has a finite common period; the eye finds it in about 90 seconds | **Incommensurable clock** (§3.5) — frequency ratios are irrational (φ, √2, √3). The composite period is infinite. |

---

## 2. Architecture overview

```
                    ┌──────────────────────────────────────────┐
   artwork URL ───► │  DECODE  (one fetch, one decode)         │
                    │  /_next/image?url=…&w=128&q=75           │
                    └───────────────┬──────────────────────────┘
                                    │ ImageData (128×128) + HTMLImageElement
                    ┌───────────────▼──────────────────────────┐
                    │  ANALYSIS  (pure, CPU, ~2ms, cached)     │
                    │  tone · edges · texture · text · subject │
                    │  style · palette (Vibrant + k-means)     │
                    └───────────────┬──────────────────────────┘
                                    │ ArtworkAnalysis  +  maskTexture (64×64 R8)
                    ┌───────────────▼──────────────────────────┐
                    │  SELECTION  (pure, deterministic)        │
                    │  vetoes → fitness scores → stable hash   │
                    └───────────────┬──────────────────────────┘
                                    │ AnimationProfile (data, not code)
                    ┌───────────────▼──────────────────────────┐
                    │  COMPOSE  (module set → GLSL, cached)    │
                    └───────────────┬──────────────────────────┘
                                    │ ShaderMaterial
                    ┌───────────────▼──────────────────────────┐
                    │  RENDER  (R3F, 1 quad, 1 draw call)      │
                    │  texture @ w=640 (already in HTTP cache) │
                    └──────────────────────────────────────────┘
```

Four stages, each independently testable, with only the last one touching the GPU.

---

## 3. The five core mechanisms

### 3.1 The protection mask — how text and logos survive

Computed once at analysis time on the 128×128 buffer:

1. Sobel gradient magnitude per pixel.
2. Local variance in 4×4 blocks (catches dense texture the Sobel under-weights).
3. Downsample to 64×64, take `max(sobel, variance)`, then **dilate by 2px**. Dilation
   matters: displacing a pixel *adjacent* to a glyph still smears the glyph's
   antialiased edge, so the mask must be wider than the feature.
4. Blur with a 3-tap Gaussian so the mask has no hard edges of its own — a hard mask
   boundary would itself be visible as a seam where motion stops.

Uploaded as a 64×64 single-channel texture: **4 KB**.

In the shader, *every* spatially-displacing term is written as:

```glsl
vec2 displaced = uv + offset * (1.0 - protect) * uAmplitude;
```

`protect` also absorbs two other inputs: the portrait-detection result (the estimated
face region is painted into the mask at 1.0, so faces never move — this is how "do not
morph faces / blink eyes / animate mouths" is enforced mechanically rather than by
choosing gentle profiles), and the text-likelihood map.

**This is the single most important idea in the design.** Everything else is polish.

### 3.2 Two-band depth — parallax without moving a single edge

We have no depth map and will not hallucinate one. The classic fake — luminance-as-height
— wobbles text and is exactly what you ruled out.

Instead, separate the image into two spatial-frequency bands using the mip chain:

```glsl
vec3 low    = textureLod(uMap, uv, 4.0).rgb;      // soft, large-scale = "background"
vec3 full   = textureLod(uMap, uv, 0.0).rgb;
vec3 detail = full - low;                          // edges, text, logos = "foreground"

vec3 shifted = textureLod(uMap, uv + parallax, 4.0).rgb;   // move ONLY the low band
vec3 result  = shifted + detail;                            // detail stays pinned
```

The background band drifts by 1–3px. The detail band — which contains 100% of the text,
logo edges and facial features — **does not move at all**. The result reads as depth
because the eye infers parallax from the relative motion of the soft field behind the
sharp field, but no edge has been displaced.

Cost: 3 texture samples. No render targets, no ping-pong.

### 3.3 The mip chain as a free blur pyramid — why there are no FBOs

Every "glow", "bloom", "atmospheric" and "soft light" effect needs a wide blur. The
textbook approach is a separable Gaussian across two render targets: 2 extra passes,
2 FBOs, ~2× the fill rate, plus resize/teardown lifecycle.

We get it for free. `texture.generateMipmaps = true` and `textureLod(uMap, uv, 5.0)` is
a ~32px-radius box-ish blur at zero marginal cost, generated once on upload by the
driver. Combined with the two-band trick above, this means:

> **The entire engine is one draw call of one quad with one shader and one texture.**

That is what makes 60fps at low GPU cost achievable rather than aspirational, and it is
why the plan targets **WebGL2 / GLSL ES 3.00** (`glslVersion: THREE.GLSL3`) — fragment-stage
`textureLod` is core there, and an extension-dependent hack on WebGL1. WebGL1 and
no-WebGL both fall back to the static image (§6.3).

### 3.4 The fidelity clamp — a compiler-enforced bound on deviation

All colour work happens in **Oklab**, because it is the only cheap space where "move
this colour slightly toward that colour" produces a result a human reads as the same
colour, slightly shifted — rather than a hue swing through mud.

Two rules, both in shader code:

```glsl
// 1. Chroma modulation only ever moves along the line to a PALETTE colour.
//    New hues are unreachable — "never introduce completely new colors" is a
//    property of the operation, not a tuning choice.
lab = mix(lab, paletteLab, amount);        // amount <= 0.06

// 2. Final clamp. Whatever the modules did, output stays within Δ of the source.
vec3 delta = clamp(lab - srcLab, -uMaxDelta, uMaxDelta);
outLab = srcLab + delta;
```

`uMaxDelta` is roughly 2 JND at `intensity="medium"`. The consequence worth stating
plainly: **at `intensity=0` the shader is provably an identity function**, which gives
us a verifiable acceptance test (§8.2).

To keep that identity exact we bypass three's colour management entirely — texture
`colorSpace = NoColorSpace`, renderer `outputColorSpace = NoColorSpace`, and explicit
sRGB↔Oklab helpers in GLSL. An sRGB→linear→sRGB round trip through an 8-bit buffer is
not lossless, and "DO NOT reduce image quality" means we don't take that round trip.

A final ±0.5/255 blue-noise dither is added, which *removes* the banding an 8-bit
gradient would otherwise show. The animated output is marginally cleaner than the
static image, not worse.

### 3.5 The incommensurable clock — why the loop is never visible

A composite of `sin(f₁t) + sin(f₂t) + …` repeats with period `LCM(1/f₁, 1/f₂, …)`. With
"nice" values like 0.05, 0.1, 0.15 that is 20 seconds and the eye finds it immediately.

`lib/artwork/engine/clock.ts` exposes a fixed set of base rates whose ratios are
irrational:

```
1.0,  0.6180339887 (1/φ),  0.4142135624 (√2−1),  0.7320508076 (√3−1),  0.2360679775 (√5−2)
```

The least common period of an irrational-ratio set is infinite — the pattern provably
never repeats, at any session length. Modules are required to draw their rates from
this table rather than hardcoding numbers.

Two supporting details:
- Time accumulates as `t += min(delta, 1/30)` rather than reading a wall clock, so a
  tab-switch or a GC pause cannot produce a visible jump when the frame resumes.
- All temporal envelopes are `smoothstep`-shaped, never linear or triangular, so there
  is no acceleration discontinuity ("no sharp acceleration", "no sudden jumps").

---

## 4. The analysis pipeline

One decode feeds everything. `lib/artwork/analysis/decode.ts` loads the image once via
the same-origin URL and hands the *same* `HTMLImageElement` to both the canvas read and
Node Vibrant — one network request, one decode, two consumers.

Every metric below is a pure function over the resulting `Uint8ClampedArray`, in its own
file under `analysis/metrics/`, unit-testable in the node environment.

| Your requirement | File | Method | Confidence |
| --- | --- | --- | --- |
| Dominant colours | `palette/swatches.ts` | k-means clusters (reused from `artwork-palette.ts`) classified into vibrant / muted / dark / light roles | High |
| Brightness | `metrics/tone.ts` | Mean perceptual luminance | High |
| Contrast | `metrics/tone.ts` | Luminance std-dev + 5th/95th percentile spread | High |
| Colour distribution | `metrics/tone.ts` | 16-bin hue histogram, entropy, dominant-hue concentration | High |
| Texture density | `metrics/texture.ts` | Mean 4×4 block variance | High |
| Edge density | `metrics/edges.ts` | Fraction of pixels above Sobel threshold | High |
| Amount of text | `metrics/text.ts` | High edge density in **horizontally elongated** clusters with **bimodal** local luminance — text has a signature no photograph has | Medium — heuristic, see §9 |
| Portrait detection | `metrics/subject.ts` | Skin-tone chroma clustering + centre-weighted saliency mass; optionally refined by `window.FaceDetector` where present, never depended on | Medium — see §9 |
| Landscape detection | `metrics/subject.ts` | Horizontal energy bands + low centre-saliency + high row-coherence | Medium |
| Illustration detection | `metrics/style.ts` | Flat-plateau ratio: fraction of pixels whose 3×3 neighbourhood is *exactly* uniform after 5-bit quantisation. Vector art has plateaus; photographs have a noise floor. | High — this one is a genuinely clean separator |
| Subject position | `metrics/subject.ts` | Saliency-weighted centroid → 3×3 zone | High |
| Visual balance | `metrics/subject.ts` | Quadrant energy variance | High |
| Negative space | `metrics/subject.ts` | Fraction of area in low-variance, low-edge blocks | High |
| Image complexity | `metrics/mood.ts` | Composite of edge + texture + colour entropy | High |
| Overall mood | `metrics/mood.ts` | Derived label (`serene`/`bold`/`intimate`/`energetic`/`stark`/`warm`) from brightness × saturation × contrast × complexity | Derived — a label over the numbers, not a separate claim |

**Caching**, following the existing module's exact pattern: module-level `Map` +
in-flight dedup for synchronous re-reads, wrapped in a **TanStack Query** with
`staleTime: Infinity` so re-opening Now Playing on the same episode is instant with no
flash, and the analysis is visible in devtools. Optionally mirrored to `sessionStorage`
(~250 bytes per artwork) so a soft navigation doesn't recompute.

---

## 5. Profiles: data, not code

### 5.1 A profile is a parameter vector

Fifteen profiles must not mean fifteen shaders. Fifteen shader programs means fifteen
compiles, fifteen pipeline states, and fifteen files to keep in sync when a shared
helper changes.

Instead there are **13 GLSL modules**, and a profile is *a set of module weights*:

| Module | Acts on | Can it displace? |
| --- | --- | --- |
| `LIGHT_DRIFT` | Luminance | No |
| `LIGHT_SWEEP` | Luminance | No |
| `BREATH` | Luminance (global) | No |
| `GLOW` | Luminance (mip-gated) | No |
| `SHADOW` | Luminance | No |
| `SPECULAR` | Luminance | No |
| `VIGNETTE_BREATH` | Luminance | No |
| `CHROMA_FLOW` | Oklab a/b | No |
| `CHROMA_EXPAND` | Oklab chroma | No |
| `TEMP_SHIFT` | Oklab b (global) | No |
| `GRAIN` | Luminance (±1/255) | No |
| `DEPTH_BAND` | Low band only | Yes — masked |
| `SURFACE` | Detail band | Yes — masked |

Only two of thirteen modules can move a pixel, and both are gated by the protection
mask. That ratio is deliberate: **luminance and chroma modulation cannot distort
typography at all**, so the overwhelming majority of the perceived "aliveness" is
generated by operations that are geometrically incapable of breaking your hard rules.

```ts
export const softLightDrift: AnimationProfile = {
  id: "soft-light-drift",
  name: "Soft Light Drift",
  modules: { LIGHT_DRIFT: 1.0, SHADOW: 0.35 },
  rates:   { primary: RATE.phi, secondary: RATE.sqrt2 },
  maxDeltaE: 1.8,
  fitness: (a) => score(a, { contrast: [0.25, 0.6], textAmount: [0, 0.25], complexity: [0.2, 0.7] }),
  vetoIf:  (a) => a.textAmount > 0.55,
};
```

Adding a profile = adding one data file and one registry line. No shader work, no new
uniforms. That is the "support future animation profiles" requirement satisfied
structurally.

### 5.2 Shader composition and program caching

`shaders/compose.ts` builds the fragment source from the active module set and caches
the compiled `ShaderMaterial` keyed by the module bitmask. Because selection is
deterministic, a real session compiles perhaps 3–4 programs total, and every subsequent
episode that lands on the same module set reuses one. Modules whose weight is 0 are
**not compiled in** — no dead ALU.

### 5.3 The 17 profiles

Fifteen as you specified, plus two that the constraint analysis showed are required:

| # | Profile | Modules | Selected for |
| --- | --- | --- | --- |
| 01 | Soft Light Drift | LIGHT_DRIFT, SHADOW | Mid-contrast photography — the safe default |
| 02 | Inner Glow Breathing | GLOW, BREATH | Dark art with a concentrated bright focal element |
| 03 | Atmospheric Colour Flow | CHROMA_FLOW, LIGHT_DRIFT | Colourful, high hue-entropy, low text |
| 04 | Micro Depth Drift | DEPTH_BAND, LIGHT_DRIFT | Clear fg/bg separation, low text |
| 05 | Gradient Bloom | GLOW, CHROMA_EXPAND | Smooth gradients, low edge density, few colours |
| 06 | Soft Texture Movement | SURFACE, GRAIN | High texture density, low text, photographic |
| 07 | Parallax Layer Motion | DEPTH_BAND, SHADOW | Strong depth cues, landscape composition |
| 08 | Ambient Light Sweep | LIGHT_SWEEP, BREATH | Bright, high-key, minimal |
| 09 | Glass Reflection Drift | SPECULAR, LIGHT_DRIFT | Glossy/high-contrast, logo-heavy — **luminance only, so text-safe** |
| 10 | Cinematic Breathing | BREATH, VIGNETTE_BREATH, TEMP_SHIFT | **Portraits/people** — entirely global, zero displacement anywhere near a face |
| 11 | Organic Shadow Shift | SHADOW, LIGHT_DRIFT (antiphase) | Mid-dark, sculptural, high texture |
| 12 | Subtle Colour Expansion | CHROMA_EXPAND, TEMP_SHIFT | Muted/desaturated art |
| 13 | Soft Volume Movement | DEPTH_BAND (low), BREATH, GLOW | Balanced, medium complexity |
| 14 | Gentle Surface Motion | SURFACE (low), LIGHT_DRIFT | Illustration with soft edges |
| 15 | Premium Ambient Flow | LIGHT_DRIFT, CHROMA_FLOW, GLOW, VIGNETTE_BREATH — all low | High-quality complex art, low text. The flagship. |
| 16 | **Quiet Luminance** | BREATH @ 0.4× | **Forced when `textAmount > 0.55`** — "text-heavy artwork should barely animate", as a rule rather than a hope |
| 17 | **Still** | — | Reduced motion, WebGL failure, pure text cards, `intensity="off"` |

### 5.4 Selection is deterministic and stable

```
1. Hard vetoes    → remove any profile whose vetoIf(analysis) is true
2. Forced routes  → textAmount > 0.55 ⇒ Quiet Luminance;  portrait ⇒ restrict to non-displacing set
3. Fitness scores → each survivor scores its feature-range fit, 0..1
4. Tie-break      → stable 32-bit hash of the artwork URL
```

Step 4 exists for a reason that only shows up in production: two profiles scoring within
0.01 of each other must not alternate between sessions. **The same show must always
animate the same way**, or the effect stops feeling designed and starts feeling random —
which is precisely the failure mode you called out. The hash makes selection a pure
function of `(analysis, url)`, so it is fully unit-testable and reproducible.

`selectProfile()` also returns an `explain` array (vetoes applied, all scores) which the
dev-only debug overlay renders.

---

## 6. Rendering and performance

### 6.1 The render loop

- One `<Canvas>`, mounted once, **never remounted between episodes** — WebGL context
  creation costs 10–30ms and browsers cap contexts at ~16 per page. Episode changes swap
  the texture and the material, not the canvas.
- `useFrame` mutates `uniform.value` in place. Zero React renders per frame.
- Playback state via `usePlayer.subscribe()`, not a hook.

### 6.2 When it runs

| State | Behaviour |
| --- | --- |
| `playing` | Full animation |
| `paused` | Amplitude eases to 0 over ~1.2s, then the loop **stops** and holds the last frame |
| `document.hidden` | Loop stops immediately |
| Off-screen (`IntersectionObserver`) | Loop stops |
| `prefers-reduced-motion` | Profile 17, one static frame, loop torn down |
| `navigator.connection.saveData` | Profile 17 |

The paused behaviour is also a design statement: *the artwork is alive because the
episode is playing.* That coupling is what makes it feel intentional rather than
decorative.

### 6.3 Adaptive quality, and never being worse than a static image

`engine/quality.ts` keeps a rolling 120-frame window of frame times. On sustained
p95 > 20ms it steps down: `dpr 2 → 1.5 → 1` → drop optional modules → **fall back to the
static image entirely** and never retry this session.

The fallback is free because of how the component is layered:

```
<div class="relative">
  <Image …/>                 ← always rendered, always the real artwork
  <canvas class="absolute"/> ← fades in over 400ms after its first frame
</div>
```

The `<Image>` is the source of truth and is never removed. The canvas is an enhancement
that appears if and only if it succeeded. Consequences: no layout shift, no blocked first
paint, correct behaviour with JS disabled, and if WebGL is missing, the driver is
blacklisted, the context is lost, or the shader fails to compile — **the user sees the
artwork exactly as they do today and nothing looks broken.**

### 6.4 Cost budget

- 1 draw call, 1 quad, ~4–7 texture samples per pixel
- At 380 CSS px × dpr 2 = 760² ≈ 578k fragments/frame ≈ 35 Mfrag/s at 60fps. Negligible
  on any GPU from the last decade, including phones.
- GPU memory: 640² RGBA + mips ≈ 2.2 MB, + 4 KB mask
- CPU per frame: ~15 uniform writes. No allocation in the loop.

---

## 7. File layout

```
lib/artwork/
  types.ts                          ArtworkAnalysis, AnimationProfile, Intensity, ModuleId
  analysis/
    analyze.ts                      orchestrator, cache, in-flight dedup
    decode.ts                       single same-origin decode (DOM-only file)
    metrics/{tone,edges,texture,text,subject,style,mood}.ts     pure, tested
    mask.ts                         protection mask build (pure) + upload helper
  palette/palette.ts                Node Vibrant + existing k-means merge
  profiles/
    types.ts  registry.ts  select.ts  score.ts
    01-soft-light-drift.ts … 17-still.ts
  shaders/
    vertex.ts
    lib/{noise,oklab,mask,fidelity,easing}.ts     shared GLSL chunks
    modules/{light-drift,light-sweep,breath,glow,shadow,specular,
             vignette,chroma-flow,chroma-expand,temp-shift,
             depth-band,surface,grain}.ts
    compose.ts                      module set → source, program cache
    uniforms.ts                     schema + defaults
  engine/
    clock.ts                        incommensurable rate table + time accumulator
    quality.ts                      adaptive quality controller
  use-artwork-analysis.ts           TanStack Query hook
  use-artwork-profile.ts

components/artwork/
  animated-artwork.tsx              public API + dynamic-import boundary + fallback
  artwork-canvas.tsx                R3F <Canvas> host  (lazy chunk)
  artwork-material.tsx              ShaderMaterial + useFrame
  artwork-debug.tsx                 dev-only overlay
```

Hooks live beside their domain in `lib/`, matching `lib/sync/use-realtime-sync.ts`.
No file exceeds ~200 lines. `lib/player/artwork-palette.ts` is **not moved or modified** —
the new palette module imports from it.

---

## 8. Public API

```tsx
<AnimatedArtwork
  src={episode.artworkUrl}
  alt=""
  playing={isPlaying}
  intensity="medium"        // "off" | "subtle" | "medium" | "expressive" | 0..1
  profile={undefined}       // ProfileId override; undefined = automatic
  sizes="(max-width: 640px) 78vw, 380px"
  priority
  className="rounded-2xl shadow-[…]"
  onAnalysis={(a) => void}  // optional, for the debug overlay
/>
```

`intensity` is a single scalar multiplied into every module amplitude and into
`uMaxDelta` — which is why 17 profiles cover the space rather than 17 × 3.

A `artworkMotion: "off" | "subtle" | "medium" | "expressive"` preference goes into the
existing `lib/prefs/store.ts` (it is exactly what that store is for: "a view preference,
not data") and surfaces in the existing settings page. Default `"medium"`.

### 8.1 Where it ships

- **Now Playing cover** — primary surface. Replaces the `<Image>` inside the existing
  `motion.div` at `now-playing.tsx`, so the paused-scale animation is untouched.
- **Player bar thumbnail (48px)** — *deliberately not*. At 48px none of this is
  perceptible and it would cost a second WebGL context. Static image stays.
- **Episode / podcast page hero** — phase 7, once the Now Playing surface is proven.

### 8.2 Acceptance tests

Unit (vitest, node env — no DOM needed):
- Each metric against synthetic buffers: a text-like buffer, a smooth gradient, a
  noise-photo buffer, a flat-plateau illustration buffer, a pure-black buffer.
- `selectProfile` — determinism (same input ⇒ same output, 1000 iterations), stability
  (same URL ⇒ same profile), and that `textAmount > 0.55` always routes to Quiet Luminance.
- Clock — no frequency pair has a rational ratio; no repeat within 24 simulated hours.
- Mask — a synthetic glyph produces `protect ≈ 1` over the glyph and its 2px dilation.

Visual, via a dev-only `/dev/artwork` route (not in CI):
- **Identity check**: render at `intensity=0`, `readPixels`, assert max per-channel
  delta ≤ 1 against the source. This is the mechanical proof of "does not modify the
  artwork".
- **Displacement check**: render a text-heavy sample at `intensity=1`, diff against
  static, assert the diff inside high-mask regions is ≤ 1/255.
- A grid of ~20 real covers across all profiles for eyeball review.

---

## 9. Honest caveats

1. **Text detection and portrait detection are heuristics, not models.** No OCR, no face
   model. They will misfire on edge cases. The design absorbs this: a false *positive*
   costs a slightly-too-calm animation (invisible), and a false *negative* on text is
   caught by the protection mask anyway, since the mask is computed from raw edge density
   and does not depend on the text classifier being right. **Two independent layers of
   protection**, and the reliable one is the fallback.

2. **`three` + `@react-three/fiber` is ≈ 150 KB gzipped** for what is one textured quad.
   Raw WebGL2 would be ~4 KB. You specified the stack and I'll build on it — the
   mitigations are `next/dynamic({ ssr: false })` so it lands in a chunk fetched only when
   Now Playing first expands, plus adding `three` to `optimizePackageImports`. The design
   also keeps the renderer host thin and swappable: analysis, profiles, selection and the
   GLSL modules are all renderer-agnostic, so if the chunk size proves unacceptable,
   replacing `artwork-canvas.tsx` + `artwork-material.tsx` (~150 lines) with a raw WebGL2
   host is a contained change that touches nothing else. **Flagging, not objecting** — say
   the word if you'd rather start raw.

3. **Node Vibrant is out; the existing k-means extractor is extended instead.** No new
   colour dependency. The k-means + cluster-analysis core of `lib/player/artwork-palette.ts`
   is *extracted* into a reusable pure function — a pure refactor, its existing test suite
   is the guard that behaviour is unchanged — and a new `palette/swatches.ts` classifies
   those same clusters into the vibrant / muted / dark / light roles the shader needs.
   One decode, one clustering pass, two consumers, zero added bundle weight.

4. **`glslVersion: GLSL3` means WebGL2 only.** ~97% of browsers. The rest get the static
   image via the existing fallback path.

---

## 10. Implementation phases

Each phase ends in a working, reviewable, independently-committable state.

| Phase | Deliverable | Verifiable by |
| --- | --- | --- |
| **1** | Deps + `types.ts` + decode + analysis metrics + tests | `npm test` — all metrics green against synthetic buffers |
| **2** | Protection mask + Vibrant palette merge + `useArtworkAnalysis` | Debug overlay renders the mask and the numbers over a real cover |
| **3** | Shader core: vertex, oklab/noise/fidelity libs, compose.ts, clock. **Zero modules.** | Identity check passes — canvas is pixel-identical to the `<Image>` |
| **4** | Non-displacing modules (11 of 13) + profiles 01,02,08,09,10,12,16,17 | Visible-but-subtle motion; identity check still passes at intensity 0 |
| **5** | `DEPTH_BAND` + `SURFACE` + remaining profiles + selection + tests | Displacement check passes on text-heavy covers |
| **6** | `AnimatedArtwork` public component, fallback layering, adaptive quality, reduced motion, prefs integration | Ships into Now Playing; verified in the browser at 60fps |
| **7** | Settings control, `/dev/artwork` gallery, episode/podcast hero rollout | Eyeball review across ~20 real covers |

Phases 1–3 are the risky ones and produce no visible motion by design — phase 3
deliberately ends with a shader that is a provable no-op, because *that* is the
foundation everything else is bounded against.

---

## 11. Decisions I need from you before starting

1. **`three` + R3F at ~150 KB lazy-chunk, or raw WebGL2 at ~4 KB?** Recommendation:
   proceed with R3F as you specified — the host is swappable later if the size bites.
2. **Node Vibrant merged alongside the existing k-means extractor, or replacing it?**
   Recommendation: merge (see §9.3).
3. **Surfaces:** Now Playing only for now, or Now Playing + episode/podcast hero in the
   same pass? Recommendation: Now Playing first (phase 6), hero in phase 7.
4. **Default intensity** for users who never touch settings. Recommendation: `"medium"`.
