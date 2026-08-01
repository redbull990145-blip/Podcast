"use client";

import { Fragment } from "react";
import { usePlayer } from "@/lib/player/store";

/** Matches [m:ss] and [h:mm:ss] timestamps the model was told to emit. */
const TIMESTAMP = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;

function toSeconds(stamp: string): number {
  const parts = stamp.split(":").map(Number);
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
}

/**
 * Renders an answer with its [mm:ss] citations turned into buttons that seek
 * the player.
 *
 * This is what makes the Q&A trustworthy rather than a black box: every claim
 * carries a link to the moment it came from, so a wrong answer is immediately
 * checkable against the audio.
 */
export function CitationText({
  text,
  episodeId,
  /** Set inside Now Playing, whose backdrop is dark whatever the theme is. */
  tone = "app",
}: {
  text: string;
  episodeId: string;
  tone?: "app" | "light";
}) {
  const seek = usePlayer((s) => s.seek);
  const currentEpisodeId = usePlayer((s) => s.episode?.id);
  const isPlayable = currentEpisodeId === episodeId;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(TIMESTAMP)) {
    const index = match.index!;
    if (index > lastIndex) {
      parts.push(
        <Fragment key={`t-${lastIndex}`}>{text.slice(lastIndex, index)}</Fragment>,
      );
    }

    const stamp = match[1];
    parts.push(
      <button
        key={`c-${index}`}
        onClick={() => seek(toSeconds(stamp))}
        disabled={!isPlayable}
        title={
          isPlayable
            ? `Jump to ${stamp}`
            : "Play this episode to jump to the cited moment"
        }
        className={
          tone === "light"
            ? "mx-0.5 rounded-full bg-white/16 px-1.5 py-0.5 align-baseline text-[11px] font-medium tabular-nums text-white transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-60"
            : "mx-0.5 rounded bg-accent-subtle px-1.5 py-0.5 align-baseline text-[11px] font-medium tabular-nums text-accent transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-60"
        }
      >
        {stamp}
      </button>,
    );

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<Fragment key="tail">{text.slice(lastIndex)}</Fragment>);
  }

  return <span className="whitespace-pre-line">{parts}</span>;
}
