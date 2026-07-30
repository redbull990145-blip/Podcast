"use client";

import { Info } from "lucide-react";
import { SKIP_CHOICES, usePlayer } from "@/lib/player/store";
import { usePrefs } from "@/lib/prefs/store";
import { cn } from "@/lib/utils";

/**
 * Skip-silence and volume boost.
 *
 * Both are honest about their one real limitation: they need the publisher's
 * host to allow cross-origin reads, and most do not. Rather than failing
 * mysteriously on those shows, the app keeps playing normally and says so.
 */
export function AudioEnhancementsPanel() {
  const powerMode = usePrefs((s) => s.powerMode);
  const skipSilence = usePlayer((s) => s.skipSilence);
  const volumeBoost = usePlayer((s) => s.volumeBoost);
  const unavailable = usePlayer((s) => s.enhancementsUnavailable);
  const setSkipSilence = usePlayer((s) => s.setSkipSilence);
  const setVolumeBoost = usePlayer((s) => s.setVolumeBoost);

  const skipForward = usePlayer((s) => s.skipForwardSeconds);
  const skipBack = usePlayer((s) => s.skipBackSeconds);
  const setSkipSeconds = usePlayer((s) => s.setSkipSeconds);

  // Skip intervals are not an advanced feature — they are the two buttons
  // everyone uses — so they stay visible whether or not power mode is on.
  const skipRows = (
    <>
      <Row
        title="Skip back"
        description="How far the back button jumps."
      >
        <SkipChoice
          value={skipBack}
          onChange={(s) => setSkipSeconds("back", s)}
          label="Skip back seconds"
        />
      </Row>
      <Row
        title="Skip forward"
        description="How far the forward button jumps. Matches skip back by default, so the two undo each other."
      >
        <SkipChoice
          value={skipForward}
          onChange={(s) => setSkipSeconds("forward", s)}
          label="Skip forward seconds"
        />
      </Row>
    </>
  );

  if (!powerMode) {
    return (
      <div>
        {skipRows}
        <div className="flex items-start gap-2.5 py-5 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p className="leading-relaxed">
            Skip silence and volume boost live behind Power user mode — turn it
            on above to configure them.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {skipRows}

      <Row
        title="Skip silence"
        description="Accelerates through pauses and gaps instead of cutting them, so speech never sounds clipped."
      >
        <Switch
          checked={skipSilence}
          onChange={setSkipSilence}
          label="Skip silence"
        />
      </Row>

      <Row
        title="Volume boost"
        description="Evens out quiet interviews against loud ad reads, then lifts the whole thing. Useful in a car or on a train."
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={3}
            step={0.25}
            value={volumeBoost}
            onChange={(e) => setVolumeBoost(Number(e.target.value))}
            aria-label="Volume boost"
            className="w-32 accent-[var(--accent)]"
          />
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
            {volumeBoost === 1 ? "Off" : `${volumeBoost}×`}
          </span>
        </div>
      </Row>

      {unavailable && (
        <p className="flex items-start gap-2.5 pb-5 text-xs leading-relaxed text-warning">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          The show playing right now is hosted somewhere that blocks the access
          these need, so they are off for this one. Playback and speed control
          are unaffected, and other shows still work.
        </p>
      )}
    </div>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-5 last:border-0">
      <div className="min-w-0 max-w-md">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

/** Segmented control for a skip interval. */
function SkipChoice({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (seconds: number) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-1 rounded-full bg-surface-raised p-1"
    >
      {SKIP_CHOICES.map((seconds) => (
        <button
          key={seconds}
          onClick={() => onChange(seconds)}
          aria-pressed={value === seconds}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium tabular-nums transition-colors duration-200 ease-[var(--ease-out)]",
            value === seconds
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {seconds}s
        </button>
      ))}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ease-[var(--ease-out)]",
        checked ? "bg-accent" : "bg-border-strong",
      )}
    >
      <span className="sr-only">{label}</span>
      <span
        aria-hidden
        className={cn(
          "absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-spring)]",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
