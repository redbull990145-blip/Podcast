"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

type StoredKey = { provider: string; keyHint: string | null; createdAt: string };

const PROVIDERS = [
  {
    id: "gemini",
    label: "Google AI Studio",
    kind: "text",
    help: "Gemini. Generous free tier.",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    kind: "text",
    help: "Llama and Nemotron. Free developer tier.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "text",
    help: "One key, most models. Has free options.",
  },
  { id: "deepseek", label: "DeepSeek", kind: "text", help: "Very cheap per token." },
  { id: "openai", label: "OpenAI", kind: "both", help: "Also covers transcription." },
  { id: "anthropic", label: "Anthropic", kind: "text", help: "Claude models." },
  { id: "groq", label: "Groq", kind: "audio", help: "Transcription only. Fast, free tier." },
] as const;

/**
 * Bring-your-own-key settings.
 *
 * Deliberately framed as an upgrade rather than a requirement: the free tier
 * works without any of this. A stored key is never sent back to the browser —
 * only the last four characters, so you can tell which key is which.
 */
export function ApiKeysPanel() {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<string>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data } = useQuery({
    queryKey: ["ai-keys"],
    queryFn: async () => (await (await fetch("/api/ai/keys")).json()) as { keys: StoredKey[] },
  });

  const { data: usage } = useQuery({
    queryKey: ["ai-usage"],
    queryFn: async () =>
      (await (await fetch("/api/ai/usage")).json()) as {
        hasOwnKey: boolean;
        jobsUsed: number;
        jobsLimit: number;
        qaUsed: number;
        qaLimit: number;
      },
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch("/api/ai/keys", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey: apiKey.trim() }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? "Couldn't save that key.");
        return;
      }

      setApiKey("");
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["ai-keys"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(providerId: string) {
    await fetch(`/api/ai/keys?provider=${providerId}`, { method: "DELETE" });
    void queryClient.invalidateQueries({ queryKey: ["ai-keys"] });
    void queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
  }

  const keys = data?.keys ?? [];

  return (
    <div className="space-y-5 py-5">
      <div className="max-w-lg">
        <h3 className="text-sm font-medium">Your own API key</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          AI features already work without this. Adding a key removes the daily
          limit and bills usage to your own account instead.
        </p>
      </div>

      {usage && !usage.hasOwnKey && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs font-medium text-muted-foreground">
            Today&apos;s free usage
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <UsageBar
              label="Generations"
              used={usage.jobsUsed}
              limit={usage.jobsLimit}
            />
            <UsageBar label="Questions" used={usage.qaUsed} limit={usage.qaLimit} />
          </div>
          <p className="mt-2 text-[11px] text-subtle-foreground">
            Resets at midnight UTC. Episodes someone else already generated
            don&apos;t count against this.
          </p>
        </div>
      )}

      {keys.length > 0 && (
        <ul className="space-y-2">
          {keys.map((key) => {
            const meta = PROVIDERS.find((p) => p.id === key.provider);
            return (
              <li
                key={key.provider}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-success/15 text-success">
                  <KeyRound className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{meta?.label ?? key.provider}</p>
                  <p className="font-mono text-xs text-subtle-foreground">
                    {key.keyHint ?? "••••"}
                  </p>
                </div>
                <button
                  onClick={() => void remove(key.provider)}
                  aria-label={`Remove ${meta?.label ?? key.provider} key`}
                  className="grid size-8 place-items-center rounded-lg text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-danger"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={save} className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="space-y-1.5">
          <Label htmlFor="ai-provider">Provider</Label>
          <select
            id="ai-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="h-10 w-full rounded-[var(--radius-app)] border border-border bg-background px-3 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.help}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-key">API key</Label>
          <Input
            id="ai-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-[11px] leading-relaxed text-subtle-foreground">
            Encrypted before it&apos;s stored, and never sent back to your
            browser — only the last four characters are shown.
          </p>
        </div>

        <Button type="submit" disabled={busy || apiKey.trim().length < 16}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {saved && <Check className="size-4" />}
          {saved ? "Saved" : "Save key"}
        </Button>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

function UsageBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground">
          {used} / {limit}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`${label} used today`}
      >
        <div
          className={percent >= 100 ? "h-full bg-danger" : "h-full bg-accent"}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
