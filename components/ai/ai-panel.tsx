"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, MessageCircleQuestion, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { CitationText } from "./citation-text";
import { askEpisode } from "@/lib/ai/ask-client";
import { cn } from "@/lib/utils";

type Usage = {
  tier: "default" | "byok";
  hasOwnKey: boolean;
  available: boolean;
  transcriptionAvailable: boolean;
  jobsUsed: number;
  jobsLimit: number;
  qaUsed: number;
  qaLimit: number;
};

type Turn = { role: "user" | "assistant"; content: string };

/** Steps shown while a generation runs, so it never looks like a dead spinner. */
const STAGES = ["Fetching audio", "Transcribing", "Writing notes"] as const;

export function AiPanel({
  episodeId,
  episodeTitle,
}: {
  episodeId: string;
  episodeTitle: string;
}) {
  const queryClient = useQueryClient();

  const { data: usage } = useQuery({
    queryKey: ["ai-usage"],
    queryFn: async () => (await (await fetch("/api/ai/usage")).json()) as Usage,
  });

  const { data: cached } = useQuery({
    queryKey: ["ai-notes", episodeId],
    queryFn: async () => {
      const res = await fetch(`/api/ai/generate?episodeId=${episodeId}`);
      return (await res.json()) as {
        showNotes: { text: string; model: string } | null;
        hasTranscript: boolean;
      };
    },
  });

  const [notes, setNotes] = useState<string | null>(null);
  const [stage, setStage] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotaHit, setQuotaHit] = useState(false);

  const showNotes = notes ?? cached?.showNotes?.text ?? null;
  const hasTranscript = Boolean(cached?.hasTranscript) || Boolean(notes);

  async function generate() {
    setError(null);
    setQuotaHit(false);
    setStage(0);

    // The server does this in one request, so advance the labels on a timer to
    // reflect roughly where it is rather than pretending to know exactly.
    const ticker = setInterval(
      () => setStage((s) => (s == null ? 0 : Math.min(s + 1, STAGES.length - 1))),
      6000,
    );

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ episodeId, kind: "show_notes" }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? "Couldn't generate show notes.");
        setQuotaHit(Boolean(body.quotaExhausted));
        return;
      }

      setNotes(body.text);
      void queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-notes", episodeId] });
      void queryClient.invalidateQueries({ queryKey: ["chapters", episodeId] });
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      clearInterval(ticker);
      setStage(null);
    }
  }

  if (usage && !usage.available) {
    return (
      <section className="rounded-app-lg border border-dashed border-border-strong p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-accent" />
          AI show notes
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-2">
          AI features aren&apos;t configured on this server yet.{" "}
          <Link href="/settings" className="text-accent hover:underline">
            Add your own API key
          </Link>{" "}
          to use them now.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-app-lg border border-border bg-surface-sunken p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-accent">
          <Sparkles className="size-3.5" />
          Summary
        </h2>
        {usage && <QuotaBadge usage={usage} />}
      </div>

      {!showNotes && (
        <div className="mt-3.5">
          <p className="text-[13px] leading-relaxed text-muted-2">
            Generate a summary, key takeaways and chapter markers from this
            episode&apos;s audio — then ask it anything.
          </p>

          {usage && !usage.transcriptionAvailable && (
            <p className="mt-3 text-xs text-warning">
              No transcription provider is configured. Add an OpenAI or Groq key
              in Settings to transcribe episodes.
            </p>
          )}

          <button
            onClick={generate}
            disabled={stage !== null}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-app bg-accent px-4 text-[13px] font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {stage !== null ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {STAGES[stage]}…
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                Generate show notes
              </>
            )}
          </button>

          {stage !== null && (
            <ol className="mt-4 flex flex-wrap gap-1.5 text-[11px]">
              {STAGES.map((label, index) => (
                <li
                  key={label}
                  className={cn(
                    "rounded-full px-2 py-0.5",
                    index < stage
                      ? "bg-success/15 text-success"
                      : index === stage
                        ? "bg-accent-subtle text-accent"
                        : "bg-surface-raised text-subtle-foreground",
                  )}
                >
                  {label}
                </li>
              ))}
            </ol>
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
              {quotaHit && (
                <>
                  {" "}
                  <Link href="/settings" className="underline">
                    Add your own key
                  </Link>{" "}
                  for unlimited use.
                </>
              )}
            </p>
          )}
        </div>
      )}

      {showNotes && (
        <>
          <div className="mt-3.5 whitespace-pre-line text-[13px] leading-relaxed text-ink-4">
            {showNotes}
          </div>
          <p className="mt-3.5 border-t border-border pt-3 text-[11px] leading-relaxed text-subtle-2">
            Generated from the episode audio. It can be wrong — check anything
            that matters against the recording.
          </p>

          {hasTranscript && (
            <AskPanel episodeId={episodeId} episodeTitle={episodeTitle} />
          )}
        </>
      )}
    </section>
  );
}

function QuotaBadge({ usage }: { usage: Usage }) {
  if (usage.hasOwnKey) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
        <KeyRound className="size-3" />
        Using your key — no limit
      </span>
    );
  }

  const left = Math.max(0, usage.jobsLimit - usage.jobsUsed);
  return (
    <Link
      href="/settings"
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
        left === 0
          ? "bg-danger/15 text-danger"
          : "bg-surface-raised text-muted-2 hover:text-foreground",
      )}
    >
      {left} of {usage.jobsLimit} left today
    </Link>
  );
}

function AskPanel({
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
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // Grows with the question, then scrolls. See the note in the player's panel.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 120)}px`;
  }, [question]);

  /** Enter sends, shift-Enter breaks the line. See the player's panel. */
  function onFieldKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void ask(event);
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
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
      setTurns((prev) => prev.slice(0, -1));
      return;
    }

    void queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold">
        <MessageCircleQuestion className="size-4 text-accent" />
        Ask about this episode
      </h3>

      {turns.length > 0 && (
        <ul className="mt-3.5 space-y-2.5">
          {turns.map((turn, index) => (
            <li
              key={index}
              hidden={turn.role === "assistant" && turn.content === ""}
              className={cn(
                "text-[13px] leading-relaxed",
                turn.role === "user"
                  ? "ml-4 rounded-[14px_14px_6px_14px] bg-accent-subtle px-3 py-2 text-foreground"
                  : "mr-2 rounded-[14px_14px_14px_6px] border border-border-2 bg-surface px-3 py-2.5 text-ink-3",
              )}
            >
              {turn.role === "assistant" ? (
                <CitationText text={turn.content} episodeId={episodeId} />
              ) : (
                turn.content
              )}
            </li>
          ))}
          {busy && turns[turns.length - 1]?.content === "" && (
            <li className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 className="size-3.5 animate-spin" />
              Reading the transcript…
            </li>
          )}
        </ul>
      )}

      <form onSubmit={ask} className="mt-3.5 flex items-end gap-2">
        <textarea
          ref={fieldRef}
          rows={1}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onFieldKeyDown}
          placeholder="Ask anything — answers cite the tape"
          aria-label={`Ask a question about ${episodeTitle}`}
          maxLength={1000}
          className="min-h-10 min-w-0 flex-1 resize-none rounded-app border border-border-input bg-surface px-3 py-2.5 text-[13px] leading-[1.5] placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          aria-label="Ask"
          className="grid size-10 shrink-0 place-items-center rounded-app bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
