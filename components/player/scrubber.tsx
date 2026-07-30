"use client";

import { Slider, type SliderTone } from "@/components/ui/slider";

/**
 * The seek bar.
 *
 * A thin wrapper over the shared slider — the seek-specific part is only that
 * it commits once when the gesture ends rather than on every input, so that
 * dragging across an hour-long episode doesn't issue a thousand seeks.
 */
export function Scrubber({
  currentTime,
  duration,
  onSeek,
  className,
  trackClassName,
  tone = "accent",
}: {
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  className?: string;
  trackClassName?: string;
  tone?: SliderTone;
}) {
  return (
    <Slider
      value={currentTime}
      max={duration || 0}
      step={1}
      onCommit={onSeek}
      disabled={duration <= 0}
      ariaLabel="Seek"
      ariaValueText={`${Math.floor(currentTime / 60)} minutes ${Math.floor(currentTime % 60)} seconds`}
      tone={tone}
      className={className}
      trackClassName={trackClassName}
    />
  );
}
