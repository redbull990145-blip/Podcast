"use client";

import { Fragment } from "react";
import { tokenizeAnswer } from "@/lib/ai/answer-format";
import { usePlayer } from "@/lib/player/store";

/**
 * Renders an answer with its [mm:ss] citations turned into buttons that seek
 * the player, and its bold runs actually bold.
 *
 * The citations are what make the Q&A trustworthy rather than a black box:
 * every claim carries a link to the moment it came from, so a wrong answer is
 * immediately checkable against the audio.
 *
 * Splitting the text is deliberately not done here — see lib/ai/answer-format,
 * where it is a pure function with tests. This component only decides what each
 * piece looks like.
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

  return (
    <span className="whitespace-pre-line">
      {tokenizeAnswer(text).map((token, index) => {
        if (token.kind === "text") {
          return <Fragment key={index}>{token.text}</Fragment>;
        }

        if (token.kind === "bold") {
          return (
            <strong key={index} className="font-semibold">
              {token.text}
            </strong>
          );
        }

        if (token.kind === "italic") {
          return <em key={index}>{token.text}</em>;
        }

        return (
          <button
            key={index}
            onClick={() => seek(token.at)}
            disabled={!isPlayable}
            title={
              isPlayable
                ? `Jump to ${token.text}`
                : "Play this episode to jump to the cited moment"
            }
            className={
              tone === "light"
                ? "mx-0.5 rounded-full bg-white/16 px-1.5 py-0.5 align-baseline text-[11px] font-medium tabular-nums text-white transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-60"
                : "mx-0.5 rounded bg-accent-subtle px-1.5 py-0.5 align-baseline text-[11px] font-medium tabular-nums text-accent transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-60"
            }
          >
            {token.text}
          </button>
        );
      })}
    </span>
  );
}
