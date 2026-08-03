"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { CitationText } from "@/components/ai/citation-text";
import { askEpisode } from "@/lib/ai/ask-client";
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
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [pinned, setPinned] = useState(true);

  /**
   * Grow the field with the question, up to about five lines, then let it
   * scroll. Height has to be reset before it is measured, or `scrollHeight`
   * reports the box it already has rather than the text it now holds, and the
   * field only ever gets taller.
   */
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 120)}px`;
  }, [question]);

  /**
   * Follow the answer down, but only while the reader is already at the bottom.
   *
   * Unconditional scrolling was fine when answers arrived whole. Now they arrive
   * a word at a time, and this effect runs on every one of them — so scrolling
   * up to re-read the start of a long answer meant being yanked back down a few
   * times a second until it finished. Whether to follow is the reader's, and
   * they say it by where they have scrolled to.
   */
  useEffect(() => {
    const thread = threadRef.current;
    if (thread && pinned) thread.scrollTop = thread.scrollHeight;
  }, [turns, busy, pinned]);

  /** Within a line or so of the end counts as the end. */
  function onThreadScroll() {
    const thread = threadRef.current;
    if (!thread) return;
    const distance = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    setPinned(distance < 24);
  }

  function scrollToLatest() {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
    setPinned(true);
  }

  /**
   * Enter sends, shift-Enter breaks the line — the convention everywhere else a
   * message gets typed, and the reason this is a textarea rather than an input.
   *
   * IME composition is checked because in a language composed through a
   * candidate window, Enter is how you accept the candidate. Sending on that
   * keystroke would post a half-typed word and there would be no way to type a
   * whole one.
   */
  function onFieldKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send(question);
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;

    setQuestion("");
    setError(null);
    setBusy(true);
    const history = turns;

    // The empty assistant turn is the bubble the answer will be written into.
    setTurns([...history, { role: "user", content: q }, { role: "assistant", content: "" }]);

    const result = await askEpisode({ episodeId, question: q, history }, (delta) =>
      setTurns((prev) => {
        const next = [...prev];
        const tail = next[next.length - 1];
        next[next.length - 1] = { ...tail, content: tail.content + delta };
        return next;
      }),
    );

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      // Nothing was ever written into it, so the placeholder goes too.
      setTurns((prev) => prev.slice(0, -1));
      return;
    }

    void queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-white/50">
        Ask this episode
      </p>

      <div className="relative mt-4 flex min-h-0 flex-1 flex-col">
      <div
        ref={threadRef}
        onScroll={onThreadScroll}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
      >
        {turns.length === 0 && !busy && (
          <p className="text-[13.5px] leading-relaxed text-white/45">
            Answers come from this episode&apos;s transcript and cite the moment
            they came from — tap a timestamp to jump there.
          </p>
        )}

        {/* The placeholder the answer streams into is empty for about a
            second; the spinner below stands in for it until it has words. */}
        {turns.map((turn, index) => (
          <div
            key={index}
            hidden={turn.role === "assistant" && turn.content === ""}
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

        {busy && turns[turns.length - 1]?.content === "" && (
          <p className="flex items-center gap-2 text-[13px] text-white/50">
            <Loader2 className="size-3.5 animate-spin" />
            Reading the transcript…
          </p>
        )}
      </div>

        {/* Only while there is something below the fold to go back to. */}
        <AnimatePresence>
          {!pinned && turns.length > 0 && (
            <motion.button
              type="button"
              onClick={scrollToLatest}
              aria-label="Scroll to the latest message"
              initial={{ opacity: 0, y: 6, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.9 }}
              transition={{ duration: 0.16 }}
              className="absolute bottom-2 left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-white/20 bg-black/70 text-white/85 shadow-lg backdrop-blur transition-colors hover:border-white/40 hover:text-white"
            >
              <ArrowDown className="size-4" strokeWidth={2} />
            </motion.button>
          )}
        </AnimatePresence>
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
        className="mt-3 flex items-end gap-2 rounded-[13px] border border-white/[0.18] bg-white/10 py-1.5 pl-4 pr-1.5"
      >
        <textarea
          ref={fieldRef}
          rows={1}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onFieldKeyDown}
          placeholder="Ask anything — answers cite the tape"
          aria-label={`Ask a question about ${episodeTitle}`}
          maxLength={1000}
          className="min-w-0 flex-1 resize-none self-center bg-transparent py-1.5 text-[13.5px] leading-[1.5] text-white placeholder:text-white/45 focus:outline-none"
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
