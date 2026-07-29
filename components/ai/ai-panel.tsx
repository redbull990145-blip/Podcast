"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, MessageCircleQuestion, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { CitationText } from "./citation-text";
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
      <section className="mt-8 rounded-xl border border-dashed border-border p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-accent" />
          AI show notes
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
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
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
          <Sparkles className="size-3.5 text-accent" />
          AI show notes
        </h2>
        {usage && <QuotaBadge usage={usage} />}
      </div>

      {!showNotes && (
        <div className="mt-3 rounded-xl border border-border bg-surface p-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
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
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-[var(--radius-app)] bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
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
            <ol className="mt-4 flex gap-2 text-[11px]">
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
          <div className="mt-3 rounded-xl border border-border bg-surface p-5">
            <div className="prose-sm whitespace-pre-line text-sm leading-relaxed text-foreground">
              {showNotes}
            </div>
            <p className="mt-4 border-t border-border pt-3 text-[11px] text-subtle-foreground">
              Generated from the episode audio. It can be wrong — check anything
              that matters against the recording.
            </p>
          </div>

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
          : "bg-surface-raised text-muted-foreground hover:text-foreground",
      )}
    >
      {left} of {usage.jobsLimit} free generations left today
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

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
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
    <div className="mt-4 rounded-xl border border-border bg-surface p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <MessageCircleQuestion className="size-4 text-accent" />
        Ask about this episode
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Answers cite the moment they came from — tap a timestamp to jump there.
      </p>

      {turns.length > 0 && (
        <ul className="mt-4 space-y-3">
          {turns.map((turn, index) => (
            <li
              key={index}
              className={cn(
                "rounded-lg px-3 py-2 text-sm leading-relaxed",
                turn.role === "user"
                  ? "bg-accent-subtle text-foreground"
                  : "bg-surface-raised text-foreground",
              )}
            >
              {turn.role === "assistant" ? (
                <CitationText text={turn.content} episodeId={episodeId} />
              ) : (
                turn.content
              )}
            </li>
          ))}
          {busy && (
            <li className="flex items-center gap-2 px-3 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Reading the transcript…
            </li>
          )}
        </ul>
      )}

      <form onSubmit={ask} className="mt-4 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`What did they say about…?`}
          aria-label={`Ask a question about ${episodeTitle}`}
          maxLength={1000}
          className="h-10 flex-1 rounded-[var(--radius-app)] border border-border bg-background px-3 text-sm placeholder:text-subtle-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          aria-label="Ask"
          className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-app)] bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
