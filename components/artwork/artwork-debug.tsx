"use client";

import { useEffect, useRef, useState } from "react";
import type { ArtworkAnalysis } from "@/lib/artwork/analysis/analyse";
import { engineStats } from "@/lib/artwork/debug";
import type { Selection } from "@/lib/artwork/profiles/select";

/**
 * What the engine decided, and why.
 *
 * Development only — see `lib/artwork/debug.ts` for why this exists at all. The
 * short version: an effect whose success condition is "you did not notice
 * anything" cannot be developed by looking at it.
 *
 * The mask preview is the most useful part. Rendering it over the artwork shows
 * exactly which regions are frozen, which is the fastest way to check that a
 * cover's typography is protected — and the fastest way to spot the failure
 * that would matter, a title the mask did not cover.
 */
export function ArtworkDebug({
  selection,
  analysis,
}: {
  selection: Selection | null;
  analysis: ArtworkAnalysis | null;
}) {
  const [showMask, setShowMask] = useState(false);
  const fps = useFrameRate();

  if (!selection || !analysis) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/75 p-2 font-mono text-[10px] leading-tight text-white">
        analysing…
      </div>
    );
  }

  const { features } = analysis;

  return (
    <>
      {showMask && <MaskOverlay analysis={analysis} />}

      <div className="absolute inset-x-0 bottom-0 max-h-[70%] overflow-auto bg-black/80 p-2 font-mono text-[10px] leading-tight text-white">
        <div className="font-bold text-emerald-300">{selection.profile.name}</div>
        <div className="text-white/60">{selection.reason}</div>

        <div className="mt-1 text-white/80">
          {selection.profile.modules.map(([id, weight]) => `${id}·${weight}`).join("  ")}
        </div>

        <Row
          label="engine fps / amp"
          value={`${fps.frames > 0 ? fps.frames : "idle"} / ${fps.intensity.toFixed(3)}`}
        />
        <Row label="clock" value={`${fps.time.toFixed(1)}s`} />
        <Row
          label="renderers built / disposed"
          value={`${engineStats.mounts} / ${engineStats.unmounts}`}
        />
        <Row label="text" value={pct(features.text.amount)} />
        <Row label="portrait" value={pct(features.subject.portraitScore)} />
        <Row label="landscape" value={pct(features.subject.landscapeScore)} />
        <Row label="illustration" value={pct(features.style.illustrationScore)} />
        <Row label="bright / contrast" value={`${pct(features.tone.brightness)} / ${pct(features.tone.contrast)}`} />
        <Row label="colourful / entropy" value={`${pct(features.tone.colorfulness)} / ${pct(features.tone.hueEntropy)}`} />
        <Row label="edges / texture" value={`${pct(features.edges.density)} / ${pct(features.texture.density)}`} />
        <Row label="complexity / space" value={`${pct(features.mood.complexity)} / ${pct(features.subject.negativeSpace)}`} />
        <Row label="mood" value={features.mood.label} />
        <Row label="frozen area" value={pct(frozenFraction(analysis))} />

        <div className="mt-1 text-white/50">
          {selection.scores.slice(0, 4).map((s) => `${s.id} ${s.score.toFixed(2)}`).join("  ·  ")}
        </div>

        {selection.vetoed.length > 0 && (
          <div className="mt-1 text-amber-300/70">
            vetoed: {selection.vetoed.map((v) => v.id).join(", ")}
          </div>
        )}

        <button
          onClick={() => setShowMask((v) => !v)}
          className="mt-1 rounded bg-white/20 px-1.5 py-0.5"
        >
          {showMask ? "hide" : "show"} protection mask
        </button>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-white/50">{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** Paints the mask in red: opaque where the artwork is frozen. */
function MaskOverlay({ analysis }: { analysis: ArtworkAnalysis }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const { mask, maskSize } = analysis;
    const image = ctx.createImageData(maskSize, maskSize);

    for (let i = 0; i < mask.length; i += 1) {
      image.data[i * 4] = 255;
      image.data[i * 4 + 3] = mask[i];
    }

    ctx.putImageData(image, 0, 0);
  }, [analysis]);

  return (
    <canvas
      ref={ref}
      width={analysis.maskSize}
      height={analysis.maskSize}
      className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
      style={{ imageRendering: "pixelated" }}
    />
  );
}

/**
 * Frames the shader actually drew in the last second.
 *
 * Counted from `engineStats` rather than from `requestAnimationFrame`, because
 * rAF keeps firing at 60Hz whatever the engine does and so cannot distinguish a
 * running animation from a stopped one — which is exactly the question this
 * readout exists to answer.
 *
 * "idle" is a correct outcome, not a fault: a paused episode ramps its
 * amplitude to zero and then tears the loop down entirely, and seeing the count
 * fall to zero a second after pausing is the confirmation that it did.
 */
function useFrameRate(): { frames: number; time: number; intensity: number } {
  const [stats, setStats] = useState({ frames: 0, time: 0, intensity: 0 });

  useEffect(() => {
    let previous = engineStats.frames;

    const timer = setInterval(() => {
      setStats({
        frames: engineStats.frames - previous,
        time: engineStats.time,
        intensity: engineStats.intensity,
      });
      previous = engineStats.frames;
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return stats;
}

function frozenFraction({ mask }: ArtworkAnalysis): number {
  let sum = 0;
  for (const value of mask) sum += value;
  return sum / (mask.length * 255);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
