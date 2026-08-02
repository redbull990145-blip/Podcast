# Plan 005 — Caption synchronisation accuracy

**Repo commit this plan was written against:** `bcb676d`
**Severity:** HIGH (correctness — cumulative, unbounded drift on long episodes)
**Files:** `lib/ai/transcribe.ts`, `colab/whisper-server.ipynb`, `lib/player/media-clock.ts` (new), `components/player/captions-panel.tsx`

---

## Summary of findings

The brief assumed the renderer was the problem. It isn't. `captions-panel.tsx`
already does the thing most web players get wrong: it reads `audio.currentTime`
inside a `requestAnimationFrame` loop, writes a single CSS custom property per
frame, and dual-drives off the store so an unfocused window degrades to 4Hz
instead of 1Hz. That is already the correct architecture, and it is better than
most shipping podcast apps.

The desync is **upstream**, in two independent places, and the two produce the
two different symptoms described:

| Symptom | Cause | Path affected |
| --- | --- | --- |
| Drift that **grows** through long episodes | Chunk offsets derived from transcribed content, not audio duration | Groq (production) |
| Constant **200–500ms** early/late | `BatchedInferencePipeline` + `vad_filter` + distilled model DTW | Colab (dev) |

There is also a third, smaller, genuinely client-side error worth fixing
(`audio.currentTime` quantisation, ~§4).

One correction to the brief: the provider is **Groq** running
`whisper-large-v3-turbo` — not "Grok". That matters, because *turbo* is the
specific variant with degraded timestamp accuracy (§2.2).

---

## 1. The cumulative drift bug (highest value fix)

### What happens

Episodes above the provider's upload cap are split into 20MB byte ranges
(`CHUNK_TARGET_BYTES`), transcribed independently, then stitched. Whisper reports
each chunk's timings from zero, so `mergeSegments` has to reconstruct where each
chunk began on the real timeline. It does this in `lib/ai/transcribe.ts:264-271`:

```ts
let cumulative = 0;
for (const chunk of chunks) {
  startTimes.push(cumulative);
  cumulative += chunkDuration(chunk);
}
```

and `chunkDuration` (`:191`) is:

```ts
const lastSegment = chunk.segments.reduce((max, s) => Math.max(max, s.end), 0);
const lastWord = chunk.words.reduce((max, w) => Math.max(max, w.end), 0);
return Math.max(lastSegment, lastWord);
```

That is **the end of the last thing Whisper transcribed**, which equals the
chunk's true audio duration only if the chunk happens to end exactly on speech.
It never does. Every chunk ends mid-music-bed, mid-silence, mid-applause, or on a
breath Whisper declined to emit — and all of that trailing time is silently
dropped from the running total.

The header comment above it currently claims:

> "That sum is exact: it does not depend on the file's bitrate or on the feed's
> reported duration, which is why a stitched-in ad can no longer accumulate error
> across the episode."

The first clause is false. It doesn't depend on *bitrate*, which is what it was
written to fix, but it very much depends on whether the chunk boundary lands on
speech.

### Why it matches the reported symptom exactly

The error is **monotonic and one-directional**: every chunk boundary can only
*lose* time, never gain it, so each subsequent chunk is placed too early, and the
deficit accumulates. Captions therefore run progressively **early**, and the
error grows linearly with the number of chunk boundaries — i.e. with episode
length. That is precisely "drift during long episodes / becomes more inaccurate
over time".

Rough magnitudes at 128kbps MP3:

| Episode | Size | Chunks | Boundaries | Drift @ 1s lost each | @ 2s |
| --- | --- | --- | --- | --- | --- |
| 30 min | ~29MB | 2 | 1 | 1s | 2s |
| 1 hour | ~58MB | 3 | 2 | 2s | 4s |
| 3 hours | ~173MB | 9 | 8 | 8s | 16s |

### Why the existing guard doesn't catch it

`MIN_TIMELINE_COVERAGE = 0.8` (`:616`) exists to catch exactly this class of
timeline corruption, and it is a good guard — but it is calibrated for gross
failure. Eight seconds lost across a three-hour episode is 99.93% coverage. It
sails through the check while being eight seconds out by the end.

### The fix

Derive each chunk's duration from **the audio itself**, not from what Whisper
said about it. The file is already classified by magic bytes (`:132-147`), and
the splittable format is already restricted to MP3 (`:126-130`) because
"its frames are self-describing" — which is exactly the property that makes this
solvable exactly.

Walk the MPEG frame headers within each byte range and sum real frame durations:

```
samplesPerFrame / sampleRate      // MPEG-1 Layer III: 1152 / 44100 = 26.122ms
```

This is exact for **both CBR and VBR**, because each frame header carries its own
bitrate and sample rate. It requires no decoding — only reading a 4-byte header
and skipping `frameLength` bytes — so it is fast enough to run over the bytes
already in memory during chunk fetch.

New module `lib/ai/mp3-frames.ts`:

```ts
/** Exact playback duration of an MP3 byte range, by summing frame headers. */
export function mp3RangeDuration(bytes: Uint8Array): {
  seconds: number;
  /** Bytes consumed by whole frames — the tail is a partial frame. */
  consumed: number;
};
```

`mergeSegments` then takes measured durations as an argument rather than
inferring them:

```ts
export function mergeSegments(
  chunks: ChunkResult[],
  /** Exact per-chunk audio durations. Falls back to inference when absent. */
  measured?: number[],
): TranscriptSegment[]
```

Keep `chunkDuration` as the documented fallback for the non-MP3 and
frame-parse-failure paths, but stop treating its answer as exact.

**Secondary benefit:** frame-aligned splitting. Splitting on arbitrary byte
offsets currently hands Whisper a partial frame at each boundary, which is a
small amount of garbage audio at the head of every chunk. `mp3RangeDuration`
returns `consumed`, so ranges can be snapped to frame boundaries and that goes
away too.

### Verification

The drift is measurable without any listening. Transcribe a known 3-hour
episode, then assert:

```
|sum(measuredChunkDurations) − audioElement.duration| < 0.5s
```

and compare against the current path, which should show the multi-second deficit.
`lib/ai/transcribe.test.ts` already covers `chunkDuration` and `mergeSegments`
(lines 46, 74), so the new cases slot in beside them.

---

## 2. Whisper timestamp quality

### 2.1 How Whisper produces word timestamps at all

Whisper is a seq2seq model; it does not natively emit word times. `word_timestamps=True`
recovers them by taking the **cross-attention weights** between audio frames and
text tokens on a hand-picked subset of "alignment heads", then running **dynamic
time warping** over that matrix to find a monotonic path. It is an inference
about where the model was looking, not a measurement of where the word was.

Consequences that matter here:

- Accuracy is roughly **±200–500ms** at the word level — which is exactly the
  constant offset the brief reports.
- It degrades on overlapping speech, music beds, laughter, and crosstalk —
  i.e. podcast audio.
- Timestamps are quantised to Whisper's 20ms frame grid at best.
- Segment-level and word-level times come from *different* passes and disagree
  at the seams. `assignWords` (`:224-240`) already documents and works around
  this, correctly, by assigning words to lines by overlap rather than by start.

**So: do not trust Whisper timestamps.** The brief's instinct here was right.

### 2.2 The turbo/distilled model problem

`whisper-large-v3-turbo` is a distilled model with **4 decoder layers** instead
of 32. The alignment heads DTW depends on live in the decoder. Fewer, retrained
decoder layers means the alignment-head selection inherited from `large-v3` is a
poorer fit, and word timestamps are measurably worse than `large-v3` even where
transcription *text* quality is comparable.

The text quality is fine. It is specifically the timings that suffer, and timings
are what this plan is about.

### 2.3 The Colab path's own bug

`colab/whisper-server.ipynb` cell 2:

```python
model = BatchedInferencePipeline(model=_model)
segments_gen, info = model.transcribe(
    path, batch_size=BATCH_SIZE, word_timestamps=True, vad_filter=True
)
```

This is the known-bad triple for timestamp fidelity:

- **`vad_filter=True`** strips non-speech, transcribes the *concatenated
  remainder*, then maps timings back through the removed intervals. Every VAD
  boundary is an opportunity for a mapping error, and the errors are one-directional
  in the same way as §1.
- **`BatchedInferencePipeline`** partitions audio into VAD-derived chunks
  processed out of order, each with its own offset. It is ~3x faster (which is
  why it's here, correctly, for iteration speed) but it compounds the above.
- **`medium`** has weaker alignment heads than `large-v3`.

For a dev-only transcript this trade was reasonable. It is not the config to
measure caption accuracy against, and it should not be what informs judgements
about whether sync "works".

---

## 3. Forced alignment — the recommendation

### Comparison

| Tool | Method | Word accuracy | Speed (3hr, T4) | Maintenance | Verdict |
| --- | --- | --- | --- | --- | --- |
| **WhisperX** | wav2vec2 CTC forced alignment | **±20–30ms** | ~2–4 min | Active, widely used | **Recommended** |
| Montreal Forced Aligner | Kaldi GMM/HMM, per-language acoustic models | ±20–40ms | ~15–30 min | Active but heavy | Best-in-class accuracy, wrong ergonomics here |
| Gentle | Kaldi + lexicon | ±30–50ms | slow | **Effectively unmaintained** | No |
| Aeneas | DTW against synthesised TTS | ±100–300ms | moderate | Low activity | Designed for sentence-level audiobook sync, too coarse |
| `stable-ts` | Post-processes Whisper's own DTW | ±100–200ms | fast | Active | Good cheap improvement, not a replacement |

### Why WhisperX

WhisperX replaces the *inference* about timing with a *measurement* of it. It
takes Whisper's transcript text as given, then runs a **CTC-based forced
alignment** against a wav2vec2 acoustic model: for each audio frame it computes
character-level emission probabilities and finds the maximum-likelihood monotonic
alignment of the known text to the known audio.

This is categorically different from DTW-over-attention:

- The text is *fixed*, so it solves a much easier problem than transcription.
- It is a phonetic measurement against the waveform, not a proxy signal.
- It is **inherently non-accumulating** — alignment is computed against absolute
  audio positions, so there is no offset to drift. This directly fixes the
  "worse over time" property regardless of §1.

It is MIT-licensed, pip-installable, runs on the same T4 the notebook already
uses, and its English model (`WAV2VEC2_ASR_BASE_960H`) is a ~360MB download.
Entirely free.

**MFA** is marginally more accurate and I would pick it for a research pipeline,
but it needs per-language acoustic + pronunciation dictionaries, a Kaldi
toolchain, and 5–10x the runtime. Wrong trade for this app.

### Where it goes

The notebook already has the right shape for this — it fetches the file itself
and polls, so there is no upload cost to adding a second pass:

```
fetch audio → faster-whisper (text + rough times) → WhisperX align → return
```

Critically, **turn off VAD and batching for the transcription pass** once
alignment is doing the timing work, or accept them only for the text. The
alignment pass needs true absolute audio positions.

Expected result: **±20–30ms**, which is below the threshold of perception for
karaoke highlighting, and stable across a 3-hour episode.

### The production path

WhisperX is Python, and production runs on Groq. Two honest options:

1. **Accept ±200–500ms in production**, fix §1 (which is the drift), and use
   WhisperX in the Colab path — where transcripts are generated for this app's
   own library anyway, and get cached per-episode for every user. Zero cost, no
   new infrastructure.
2. **Add a free alignment worker** (HF Spaces free tier, or Modal's free
   monthly credits) invoked after Groq returns. More moving parts.

Recommend (1) first. §1 is the bug; §2 is polish, and the polish is only worth
paying infrastructure for after the bug is gone.

---

## 4. The client-side clock

### What to use — and what not to

| Source | Verdict |
| --- | --- |
| `audio.currentTime` | **Yes — this is the authority.** It *is* the media clock. |
| `requestAnimationFrame` | **Yes, as the sampler**, paired with the store for unfocused windows. |
| `AudioContext.currentTime` | **No.** It is a *wall clock*. It keeps advancing through stalls, buffering, and decode underruns. Using it would introduce drift, not remove it. |
| `requestVideoFrameCallback` | N/A — video only. |
| Media Session API | Metadata and OS controls only. Not a clock. |
| `performance.now()` | **Yes, but only as an interpolator between element samples** (below). |

The app already uses a `MediaElementAudioSourceNode` (`lib/player/audio-graph.ts`)
for boost and skip-silence. That does **not** change the answer: routing through
Web Audio doesn't make `AudioContext.currentTime` the media position, it just
gives the element's output somewhere to go. `audio.currentTime` remains correct.

The current implementation already gets all of this right.

### The remaining client-side error: quantisation

`audio.currentTime` does not advance continuously. Browsers update it per decoded
block — coarser in Safari than Chrome, and coarser again under load. Sampling it
per-rAF therefore yields a **staircase**, not a ramp, and the karaoke fill
inherits the steps.

Apple-grade fix is a **media clock estimator**: hold the last
`(currentTime, performance.now())` pair, project forward with `performance.now()`
scaled by `playbackRate`, and hard-resync whenever the element publishes a value
that disagrees by more than a threshold.

New `lib/player/media-clock.ts`:

```ts
/**
 * A continuous estimate of playback position.
 *
 * `audio.currentTime` advances in steps of one decoded block, so reading it once
 * a frame produces a staircase. Between element updates this projects forward
 * using performance.now() scaled by playbackRate, and snaps back to the element
 * whenever the two disagree by more than RESYNC_THRESHOLD — which is what makes
 * a seek, a stall or a buffer underrun correct itself on the next frame rather
 * than being smoothed over.
 */
export function createMediaClock(audio: HTMLAudioElement): {
  now(): number;
  reset(): void;
};
```

Rules it must obey:

- **Never advance while `paused`, `seeking`, or `readyState < HAVE_FUTURE_DATA`.**
  Projecting through a stall is the one way this can make things *worse*.
- **Scale by `playbackRate`** — this app supports 0.5×–3×, so an unscaled
  projection would be up to 3x wrong.
- **Resync hard, not smoothly**, past ~100ms disagreement. Smoothing a real seek
  is drift.
- **Clamp monotonic during normal playback**; allow backwards jumps only on
  `seeking`/`seeked`.

This is a genuine improvement but it is worth being clear about scale: it buys
tens of milliseconds of smoothness. §1 buys seconds of correctness. Do §1 first.

---

## 5. Everything else the brief asked about

Brief answers, since most are already handled correctly:

- **VBR vs CBR** — real, and already fought once. `audio.duration` for a
  headerless VBR MP3 is an *extrapolation* the browser revises as it buffers;
  `useSettledDuration` (`captions-panel.tsx:765`) already waits for it to hold
  still, and `caption-sync.ts` documents the resume-mid-episode failure it caused.
  Frame-header parsing (§1) removes the last dependence on it.
- **playbackRate** — affects the estimator (§4) only. `audio.currentTime` is
  already rate-correct.
- **Seeking / pause / resume** — handled by resync (§4). The existing code
  reconciles optimistically then corrects on `seeked`/`timeupdate` (`store.ts:440`).
- **Buffering / stalls** — the estimator must freeze, not project. See §4 rules.
- **Browser loses focus** — already solved: rAF throttles to ~1fps unfocused, and
  the store subscription holds the floor at `timeupdate`'s ~4Hz. This is
  documented at `captions-panel.tsx:796-802` and is a genuinely good piece of
  engineering.
- **React render delay** — already avoided; the per-frame path writes one custom
  property and touches no React state.
- **Timestamp rounding** — store as `number` seconds (float64). Do not round to
  ms on write; the JSON cost is trivial next to the text.
- **Network delay** — irrelevant to sync. Position comes from the element.
- **Long-episode drift** — §1 and §3. Both remove the accumulating term entirely.

### Data format

The current `TranscriptWord { start, end, text }` is close to sufficient. Add
only what is used:

```ts
export type TranscriptWord = {
  start: number;
  end: number;
  text: string;
  /** Alignment confidence 0-1. Absent when not force-aligned. */
  score?: number;
  /** Speaker label, when diarisation ran. */
  speaker?: string;
};
```

`score` is worth adding because WhisperX returns it and it enables a real
improvement: a word aligned with low confidence can fall back to interpolation
rather than confidently highlighting the wrong word. Do **not** add `phraseId` —
lines are computed at render time by `captionLines()`, deliberately, so that the
line-breaking heuristic can be changed without regenerating transcripts.

### Rendering

Already done, and done well. `caption-motion.ts` documents measured values off
Spotify's lyrics view (emphasis table, 0.41 anchor), and `fillingWordIndex`
exists specifically because `background-clip: text` on every word cost a measured
152ms stall. Nothing to redesign. Speaker colours would slot into the existing
per-word span rendering if `speaker` is added above.

---

## Execution order

1. **§1 chunk-duration fix. — DONE.** See "Implementation notes" below.
2. **§2.3 notebook config.** One-line change to stop `vad_filter`/batching
   corrupting dev-path timings, so that §1's fix can actually be evaluated.
3. **§3 WhisperX** in the notebook. Biggest quality win, no production risk.
4. **§4 media clock.** Polish. Only perceptible once 1–3 are done.

Do not start at 4. It is the most fun and the least valuable.

## Edge cases

| Case | Handling |
| --- | --- |
| M4A | **Correction to an earlier draft of this plan:** M4A *is* chunked, by `transcribeMp4Chunked`, so it had the same bug. Its sample table carries a per-sample duration, so `groupSeconds` measures it exactly. |
| MP3 frame parse fails | Fall back to `chunkDuration`, log, keep the coverage guard. |
| Chunk with no speech at all | `chunkDuration` returns 0 today — a whole chunk of timeline vanishes. Frame parsing fixes this outright. |
| ID3v2 tag at file head | Skip via the tag's declared size before frame-walking. |
| Publisher transcript (no words) | Unchanged; `captionWords` interpolates proportionally, and `captionOffsetFor` still applies the ad-insertion shift. |
| WhisperX drops a word | `score`-aware fallback to interpolation, as above. |
| Seek during a stall | Estimator freezes on `seeking`, resyncs on `seeked`. |

---

## Implementation notes (§1, landed)

Two things came out differently from the plan as written above.

**M4A was affected too.** The plan claimed M4A isn't chunked. It is —
`transcribeMp4Chunked` splits it into sample groups and had exactly the same
bug. Its sample table carries a per-sample duration in a known timescale, so
`groupSeconds()` measures a group exactly, with nothing left over.

**The result is exact, not approximate.** The plan predicted a residual of about
one frame (26ms) per boundary, on the reasoning that a frame cut in half by a
byte boundary is lost to both chunks. It doesn't have to be: the split frame's
*header* lives in the earlier chunk, and the later chunk necessarily starts at
the following header — `prepareChunk` aligns to the first *parseable* frame, and
an orphaned body fragment has no header to be found by. So counting the trailing
partial frame in the chunk that holds its header counts every frame in the file
exactly once. `frameSeconds` does that, and the end-to-end test asserts the
reconstructed timeline matches the true duration to 9 decimal places across 24
boundaries of a variable-bitrate stream.

### What landed

| File | Change |
| --- | --- |
| `lib/ai/mp3.ts` | `Mp3Frame` gains `samples`/`sampleRate`; new `frameSeconds()` |
| `lib/ai/mp4.ts` | New `groupSeconds()` |
| `lib/ai/transcribe.ts` | `PreparedChunk` type; `ChunkResult.seconds`; `mergeSegments` prefers it; `fetchChunk`/`buildMp4Chunk` measure |

`chunkDuration` is kept as the documented fallback for audio neither parser can
read, and its comment no longer claims the sum is exact.

### Still to do

Steps 2–4 (notebook VAD/batching config, WhisperX forced alignment, media clock)
are untouched. Note that **existing cached transcripts keep their old timings** —
the fix applies at generation time, so anything already transcribed needs
regenerating to benefit.
