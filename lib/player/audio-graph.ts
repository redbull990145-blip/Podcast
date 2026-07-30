"use client";

/**
 * Optional Web Audio processing: skip-silence and volume boost.
 *
 * These need to read the decoded waveform, which means routing the element
 * through a MediaElementAudioSourceNode — and that only works if the audio was
 * fetched with CORS. Most podcast hosts send no CORS headers at all, so the
 * element is created without `crossOrigin` (see lib/player/store.ts) and plain
 * playback always works.
 *
 * Turning these on therefore requires reloading the current episode in CORS
 * mode. If the host refuses, playback would break outright, so the reload is
 * probed first and the feature silently stays off for that show. Ordinary
 * listening is never put at risk by an enhancement.
 */

export type GraphState = {
  /** Attached and processing. */
  active: boolean;
  /** The host refused a CORS request, so this show can't be enhanced. */
  unavailable: boolean;
};

type Graph = {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
  compressor: DynamicsCompressorNode;
  gain: GainNode;
  element: HTMLAudioElement;
};

/**
 * One graph per element, for the lifetime of the page.
 *
 * createMediaElementSource throws if called twice on the same element, and the
 * connection cannot be undone — so the graph is built once and thereafter
 * bypassed by setting neutral values rather than torn down.
 */
let graph: Graph | null = null;

/** Above this RMS, audio counts as speech rather than silence. */
const SILENCE_THRESHOLD = 0.015;

/** Silence must last this long before skipping, so natural pauses survive. */
const MIN_SILENCE_SECONDS = 0.35;

/** Playback rate multiplier applied while skipping through silence. */
const SILENCE_SPEEDUP = 3;

/** How often the analyser is sampled. Frequent enough to catch short gaps. */
const SAMPLE_INTERVAL_MS = 60;

/**
 * Checks whether an audio URL can be fetched with CORS.
 *
 * A HEAD request in cors mode fails fast when the host sends no
 * Access-Control-Allow-Origin, which is exactly what we need to know before
 * risking the element's `src`.
 */
export async function supportsCors(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    // Range-limited GET rather than HEAD: some CDNs answer HEAD without the
    // CORS headers they attach to a real GET, which would be a false negative.
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      headers: { range: "bytes=0-0" },
      signal,
    });
    return response.ok || response.status === 206;
  } catch {
    return false;
  }
}

function buildGraph(element: HTMLAudioElement): Graph | null {
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  try {
    const context = new Ctor();
    const source = context.createMediaElementSource(element);

    const analyser = context.createAnalyser();
    // Small window: we only need a loudness estimate, and a big FFT would cost
    // more per sample for no benefit.
    analyser.fftSize = 512;

    // The compressor evens out the wild level differences between a quiet
    // interview and a loud ad read, which is what makes boost usable rather
    // than just louder.
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -28;
    compressor.knee.value = 24;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;

    const gain = context.createGain();
    gain.gain.value = 1;

    source.connect(analyser);
    analyser.connect(compressor);
    compressor.connect(gain);
    gain.connect(context.destination);

    return { context, source, analyser, compressor, gain, element };
  } catch {
    // Already-connected element, or a browser that refuses. Plain playback is
    // unaffected either way.
    return null;
  }
}

/**
 * Builds the graph for an element, replacing any graph on a previous one.
 *
 * The store swaps the audio element when it needs to move between plain and
 * CORS playback, so the old context is closed rather than left running — an
 * abandoned AudioContext keeps an audio thread alive and browsers cap how many
 * a page may have.
 */
export function ensureGraph(element: HTMLAudioElement): Graph | null {
  if (graph?.element === element) return graph;

  if (graph) {
    stopSilenceEngine();
    void graph.context.close().catch(() => undefined);
    graph = null;
  }

  graph = buildGraph(element);
  return graph;
}

/** True when the graph is attached to this exact element. */
export function isGraphAttachedTo(element: HTMLAudioElement): boolean {
  return graph?.element === element;
}

/** Tears the graph down entirely, for when the element goes back to plain playback. */
export function teardownGraph() {
  stopSilenceEngine();
  if (graph) {
    void graph.context.close().catch(() => undefined);
    graph = null;
  }
}

/** Linear gain. 1 is untouched; the UI caps this well below clipping. */
export function setBoost(multiplier: number) {
  if (!graph) return;
  graph.gain.gain.value = Math.max(1, Math.min(3, multiplier));
  // A suspended context produces silence; resuming is safe to call repeatedly.
  void graph.context.resume().catch(() => undefined);
}

let silenceTimer: ReturnType<typeof setInterval> | null = null;
let silenceElapsed = 0;

function stopSilenceEngine() {
  if (silenceTimer) {
    clearInterval(silenceTimer);
    silenceTimer = null;
  }
  silenceElapsed = 0;
}

/**
 * Starts or stops silence skipping.
 *
 * Rather than seeking past quiet stretches — which sounds abrupt and fights
 * buffering — this accelerates through them and drops back to the chosen speed
 * the moment speech returns. `baseRate` is read live so changing speed while
 * this is on behaves sensibly.
 */
export function setSkipSilence(enabled: boolean, baseRate: () => number) {
  stopSilenceEngine();

  if (!graph) return;

  const { analyser, element } = graph;

  if (!enabled) {
    element.playbackRate = baseRate();
    return;
  }

  const samples = new Float32Array(analyser.fftSize);

  silenceTimer = setInterval(() => {
    if (element.paused) return;

    analyser.getFloatTimeDomainData(samples);

    let sumSquares = 0;
    for (const sample of samples) sumSquares += sample * sample;
    const rms = Math.sqrt(sumSquares / samples.length);

    const rate = baseRate();

    if (rms < SILENCE_THRESHOLD) {
      silenceElapsed += SAMPLE_INTERVAL_MS / 1000;
      if (silenceElapsed >= MIN_SILENCE_SECONDS) {
        // Cap at 4x: browsers mute playback above it, which would make a long
        // gap silent-and-slow rather than fast.
        element.playbackRate = Math.min(4, rate * SILENCE_SPEEDUP);
      }
    } else {
      silenceElapsed = 0;
      if (element.playbackRate !== rate) element.playbackRate = rate;
    }
  }, SAMPLE_INTERVAL_MS);
}

/** Returns processing to neutral without detaching, for a mid-episode toggle off. */
export function resetGraph(baseRate: number) {
  stopSilenceEngine();
  if (graph) {
    graph.gain.gain.value = 1;
    graph.element.playbackRate = baseRate;
  }
}
