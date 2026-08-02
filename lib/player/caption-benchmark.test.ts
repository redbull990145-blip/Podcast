import { describe, expect, it } from "vitest";
import { activeSegmentIndex, captionLines } from "./captions";
import { captionWords, fillFraction, fillingWordIndex } from "./caption-motion";
import { repairTranscript } from "./transcript-integrity";
import { measureRows, visibleRange } from "./virtual-list";
import type { TranscriptSegment } from "@/lib/db/schema";

/**
 * What the synchronisation path costs at the scale the brief asks for.
 *
 * These are guards, not a report. The thresholds are set well above the
 * measured figures — roughly an order of magnitude — because the point is to
 * catch an algorithmic regression (a scan that became a scan-per-frame, a cache
 * that stopped hitting) rather than to police a few percent of noise on a
 * shared runner. The measured numbers are printed so a change in them is
 * visible even when nothing fails.
 *
 * The budget that matters is the per-frame one. At 60fps a frame is 16.67ms,
 * and the captions are not the only thing in it: audio decoding, React, the
 * list's own spring and the virtualiser all share the main thread. Anything
 * over about 1ms per frame here is taking a share it has not earned.
 */

/** 60fps. */
const FRAME_BUDGET_MS = 16.67;

/**
 * The share of a frame the whole caption path may use.
 *
 * 6% — an order of magnitude below the point where it could cause a dropped
 * frame on its own, which is the right place for a component that is not the
 * reason the page exists.
 */
const CAPTION_FRAME_SHARE = 0.06;

function bench(label: string, iterations: number, fn: () => void): number {
  // One untimed pass so the first run's JIT warm-up is not the measurement.
  fn();

  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) fn();
  const total = performance.now() - started;

  const each = total / iterations;
  const shown = each < 0.001 ? `${(each * 1000).toFixed(2)}µs` : `${each.toFixed(4)}ms`;
  console.log(`  ${label.padEnd(46)} ${shown.padStart(11)}  (×${iterations})`);
  return each;
}

/**
 * A transcript shaped like Whisper's real output.
 *
 * Measured on a real episode and quoted in `captions.ts`: a median of 27.1
 * seconds and 47 words per segment. Generating anything tidier would make the
 * line splitter's job easier than it is in practice.
 */
function whisperTranscript(totalWords: number): TranscriptSegment[] {
  const WORDS_PER_SEGMENT = 47;
  const SEGMENT_SECONDS = 27.1;
  const count = Math.ceil(totalWords / WORDS_PER_SEGMENT);
  const vocabulary = [
    "the", "and", "that", "have", "for", "not", "with", "you", "this", "but",
    "his", "from", "they", "say", "her", "she", "will", "one", "all", "would",
    "there", "their", "what", "about", "which", "when", "make", "like", "time",
  ];

  return Array.from({ length: count }, (_, i) => {
    const start = i * SEGMENT_SECONDS;
    const perWord = SEGMENT_SECONDS / WORDS_PER_SEGMENT;
    const words = Array.from({ length: WORDS_PER_SEGMENT }, (_, w) => ({
      start: start + w * perWord,
      end: start + (w + 1) * perWord * 0.92,
      text: vocabulary[(i * 7 + w * 13) % vocabulary.length],
    }));
    return {
      start,
      end: start + SEGMENT_SECONDS,
      // Every ninth segment ends on a sentence, so the splitter has real
      // punctuation to break on rather than only hitting the word ceiling.
      text: words.map((w) => w.text).join(" ") + (i % 9 === 0 ? "." : ""),
      words,
    };
  });
}

describe("scale: a three-hour episode, 100k words", () => {
  const WORDS = 100_000;
  const raw = whisperTranscript(WORDS);

  it("reports the shape it is working with", () => {
    const lines = captionLines(repairTranscript(raw).segments);
    console.log(
      `\n  provider segments ${raw.length}, caption lines ${lines.length}, words ${WORDS}\n`,
    );
    expect(lines.length).toBeGreaterThan(10_000);
  });

  it("loads once, cheaply", () => {
    const repair = bench("repairTranscript (once per load)", 5, () => {
      repairTranscript(raw);
    });
    const split = bench("captionLines (once per load)", 5, () => {
      captionLines(repairTranscript(raw).segments);
    });
    const lines = captionLines(repairTranscript(raw).segments);
    const measure = bench("measureRows (once per load)", 20, () => {
      measureRows(lines.map(() => 44), 2);
    });

    // A load is allowed to be slow relative to a frame; it happens once and
    // behind a skeleton. It is not allowed to be seconds.
    expect(repair).toBeLessThan(400);
    expect(split).toBeLessThan(800);
    expect(measure).toBeLessThan(120);
  });

  it("costs almost nothing per frame in steady-state playback", () => {
    const lines = captionLines(repairTranscript(raw).segments);
    const metrics = measureRows(lines.map(() => 44), 2);

    // Warm the word cache the way playback does — one line at a time, not all
    // at once. Only the active line is ever measured here.
    let previous = 0;
    let time = 0;
    const step = 1 / 60;

    const perFrame = bench("full per-frame path (index + fill + window)", 20_000, () => {
      time += step;
      const index = activeSegmentIndex(lines, time, previous);
      previous = index;
      const line = lines[index] ?? lines[0];
      const fill = fillFraction(line, time);
      fillingWordIndex(captionWords(line), fill);
      visibleRange(metrics, index * 44, 600);
    });

    console.log(
      `  → ${((perFrame / FRAME_BUDGET_MS) * 100).toFixed(3)}% of a 60fps frame\n`,
    );

    expect(perFrame).toBeLessThan(FRAME_BUDGET_MS * CAPTION_FRAME_SHARE);
  });

  it("recovers from the worst possible seek in one frame", () => {
    const lines = captionLines(repairTranscript(raw).segments);

    // Seeking to the start while the hint points at the very last line is the
    // only case that walks the whole array, and it is bounded by doing so
    // exactly once — the next frame resumes from the new answer.
    const worst = bench("backward seek, end → 0 (hint fully invalid)", 2_000, () => {
      activeSegmentIndex(lines, 0.5, lines.length - 1);
    });

    expect(worst).toBeLessThan(FRAME_BUDGET_MS * CAPTION_FRAME_SHARE);
  });

  it("caches word splitting, so a line is only tokenised once", () => {
    const lines = captionLines(repairTranscript(raw).segments);
    const sample = lines[5_000];

    const cold = bench("captionWords, cold (once per line)", 1, () => {
      captionWords(sample);
    });
    const warm = bench("captionWords, cached (every frame)", 200_000, () => {
      captionWords(sample);
    });

    // The cache is what keeps the per-frame path flat. If this ratio collapses,
    // the WeakMap key has stopped matching and every frame is re-tokenising.
    expect(warm).toBeLessThan(cold);
    expect(warm).toBeLessThan(0.001);
  });

  /**
   * Structure rather than heap bytes, deliberately.
   *
   * The first version of this test sampled `process.memoryUsage().heapUsed`
   * either side of building the transcript and reported the difference. It
   * printed **-135MB** — a garbage collection had run in between, so the
   * measurement was not of the transcript at all. A benchmark that can report a
   * negative allocation is not measuring anything, and without `--expose-gc`
   * there is no way to make that sampling deterministic inside the normal test
   * run.
   *
   * What actually decides the footprint is how many objects are retained and
   * whether that count is linear in the input. Both are exactly measurable and
   * neither depends on when the collector happens to run, so that is what is
   * asserted; the byte figure is derived from a stated per-object estimate and
   * printed as an estimate rather than passed off as a measurement.
   */
  it("retains a linear number of objects, not a quadratic one", () => {
    const lines = captionLines(repairTranscript(raw).segments);

    let wordObjects = 0;
    for (const line of lines) wordObjects += captionWords(line).length;

    // V8: a small object with five own properties, two of them short strings.
    const BYTES_PER_WORD = 120;
    const BYTES_PER_LINE = 200;
    const estimateMb =
      (wordObjects * BYTES_PER_WORD + lines.length * BYTES_PER_LINE) / 1024 / 1024;

    console.log(
      `  ${lines.length} lines, ${wordObjects} word objects` +
        ` — estimated ~${estimateMb.toFixed(1)}MB retained\n`,
    );

    // Linear in the words that went in. A splitter that duplicated words across
    // line boundaries, or a cache keyed so that both the provider segment and
    // the derived line retained their own copies, would show up here.
    expect(wordObjects).toBeGreaterThan(WORDS * 0.95);
    expect(wordObjects).toBeLessThan(WORDS * 1.3);
    expect(lines.length).toBeLessThan(WORDS / 3);
  });
});

describe("scale: sustained playback", () => {
  it("does not degrade over an hour of frames", () => {
    // A per-frame cost that creeps up is the signature of an accumulating
    // structure — a growing cache, a listener never removed, a hint that stops
    // being useful. Comparing the first and last minute catches it.
    const lines = captionLines(repairTranscript(whisperTranscript(60_000)).segments);

    const minute = (from: number) => {
      let previous = activeSegmentIndex(lines, from, 0);
      const started = performance.now();
      for (let f = 0; f < 3_600; f += 1) {
        const time = from + f / 60;
        previous = activeSegmentIndex(lines, time, previous);
        fillFraction(lines[previous] ?? lines[0], time);
      }
      return performance.now() - started;
    };

    const first = minute(0);
    minute(1_800);
    const last = minute(3_540);

    console.log(
      `  first minute ${first.toFixed(1)}ms, last minute ${last.toFixed(1)}ms\n`,
    );

    // Allow a wide band — this is checking for growth, not for equality.
    expect(last).toBeLessThan(Math.max(first * 4, 60));
  });
});
