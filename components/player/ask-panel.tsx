"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowUp, Loader2 } from "lucide-react";
import { CitationText } from "@/components/ai/citation-text";
import { press, pressSubtle } from "@/lib/motion/gestures";
import { cn } from "@/lib/utils";

type Turn = { role: "user" | "assistant"; content: string };

/** Offered before the first question, so the field is never a blank prompt. */
const OPENERS = [
  "Give me the three-line version",
  "What did I just miss?",
  "Who is being interviewed?",
];

/**
 * Ask-this-episode, beside the artwork in Now Playing.
 *
 * The same endpoint as the panel on the episode page, in the player's colours
 * rather than the app's — Now Playing resolves to a dark backdrop whatever the
 * theme is, so nothing in here can take its colours from the palette.
 *
 * It answers from the episode's transcript, which means it only works once one
 * exists. That is stated where the answers would be rather than hidden behind a
 * disabled input.
 */
export function AskPanel({
  episodeId,
  episodeTitle,
}: {
  episodeId: string;
  episodeTitle: string;
}) {
  const queryClient = useQueryClient();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Answers arrive at the bottom; without this the newest one lands below the
  // fold of a panel the reader is already looking at.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [turns, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;

    setQuestion("");
    setError(null);
    setBusy(true);
    const history = turns;
    setTurns([...history, { role: "user", content: q }]);

    try {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ episodeId, question: q, history }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? "Couldn't answer that.");
        return;
      }

      setTurns((prev) => [...prev, { role: "assistant", content: body.answer }]);
      void queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-white/50">
        Ask this episode
      </p>

      <div
        ref={threadRef}
        className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
      >
        {turns.length === 0 && !busy && (
          <p className="text-[13.5px] leading-relaxed text-white/45">
            Answers come from this episode&apos;s transcript and cite the moment
            they came from — tap a timestamp to jump there.
          </p>
        )}

        {turns.map((turn, index) => (
          <div
            key={index}
            className={cn(
              "text-[13.5px] leading-relaxed",
              turn.role === "user"
                ? "self-end max-w-[78%] rounded-[16px_16px_6px_16px] bg-white/14 px-4 py-3"
                : "max-w-[88%] rounded-[16px_16px_16px_6px] border border-white/12 bg-black/40 px-4 py-3.5 leading-[1.72] text-white/88",
            )}
          >
            {turn.role === "assistant" ? (
              <CitationText text={turn.content} episodeId={episodeId} tone="light" />
            ) : (
              turn.content
            )}
          </div>
        ))}

        {busy && (
          <p className="flex items-center gap-2 text-[13px] text-white/50">
            <Loader2 className="size-3.5 animate-spin" />
            Reading the transcript…
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-red-300">
          {error}
        </p>
      )}

      {turns.length === 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {OPENERS.map((opener) => (
            <motion.button
              {...pressSubtle}
              key={opener}
              onClick={() => void send(opener)}
              disabled={busy}
              className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/75 transition-colors hover:border-white/40 hover:text-white disabled:opacity-50"
            >
              {opener}
            </motion.button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(question);
        }}
        className="mt-3 flex h-11 items-center gap-2 rounded-[13px] border border-white/[0.18] bg-white/10 pl-4 pr-1.5"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything — answers cite the tape"
          aria-label={`Ask a question about ${episodeTitle}`}
          maxLength={1000}
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-white placeholder:text-white/45 focus:outline-none"
        />
        <motion.button
          {...press}
          type="submit"
          disabled={busy || !question.trim()}
          aria-label="Ask"
          className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[#f7f5f0] text-[#1a1c18] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowUp className="size-4" strokeWidth={2} />
          )}
        </motion.button>
      </form>
    </div>
  );
}
