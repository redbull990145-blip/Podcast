"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Upload } from "lucide-react";
import type { ImportOutcome } from "@/app/api/opml/import/route";
import { Button } from "@/components/ui/button";

type Progress = {
  total: number;
  done: number;
  results: ImportOutcome[];
};

/**
 * OPML import and export.
 *
 * Import is chunked from the client so a large library does not hit the
 * serverless execution limit: the file goes up once, then the browser keeps
 * posting back the remaining feed URLs. That also means real progress can be
 * shown instead of an indeterminate spinner.
 */
export function OpmlPanel() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setImporting(true);
    setProgress(null);

    try {
      const text = await file.text();

      let res = await fetch("/api/opml/import", {
        method: "POST",
        headers: { "content-type": "text/x-opml+xml" },
        body: text,
      });
      let body = await res.json();

      if (!res.ok) {
        setError(body.error ?? "Couldn't read that file.");
        return;
      }

      const total: number = body.totalFound ?? 0;
      let results: ImportOutcome[] = body.results ?? [];
      setProgress({ total, done: results.length, results });

      // Keep posting the remainder until the server says it is finished.
      while (!body.done) {
        res = await fetch("/api/opml/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ feedUrls: body.remaining }),
        });
        body = await res.json();
        if (!res.ok) {
          setError(body.error ?? "The import stopped partway through.");
          break;
        }
        results = [...results, ...(body.results ?? [])];
        setProgress({ total, done: results.length, results });
      }

      router.refresh();
    } catch {
      setError("Couldn't read that file.");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const failures = progress?.results.filter((r) => r.status === "failed") ?? [];
  const added = progress?.results.filter((r) => r.status === "added").length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-5">
        <div className="max-w-md">
          <h3 className="text-sm font-medium">Export your subscriptions</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Downloads a standard OPML file that any other podcast app can read.
            No paywall, no confirmation step.
          </p>
        </div>
        {/* A plain link, not a fetch — the browser handles the download. */}
        <a href="/api/opml/export" download>
          <Button variant="secondary">
            <Download className="size-4" />
            Export OPML
          </Button>
        </a>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-5">
        <div className="max-w-md">
          <h3 className="text-sm font-medium">Import from another app</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Bring your library across from Apple Podcasts, Pocket Casts,
            Overcast, or anything else that exports OPML.
          </p>
        </div>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept=".opml,.xml,text/xml,application/xml,text/x-opml+xml"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button
            variant="secondary"
            onClick={() => fileInput.current?.click()}
            disabled={importing}
          >
            {importing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {importing ? "Importing…" : "Choose file"}
          </Button>
        </div>
      </div>

      {progress && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {importing ? "Importing…" : "Import finished"}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {progress.done} / {progress.total}
            </span>
          </div>

          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemin={0}
            aria-valuemax={progress.total}
          >
            {/*
              scaleX rather than width: width is a layout property, so animating
              it re-lays-out the bar and its ancestors on every step. A transform
              stays on the compositor, which is the rule the rest of the app
              follows — see the note at the top of lib/motion/variants.ts.
            */}
            <div
              className="h-full origin-left bg-accent transition-transform duration-[var(--duration-normal)] ease-[var(--ease-out)]"
              style={{
                transform: `scaleX(${progress.total ? progress.done / progress.total : 0})`,
              }}
            />
          </div>

          <p className="mt-3 text-sm text-muted-foreground">
            {added} show{added === 1 ? "" : "s"} added
            {failures.length > 0 && `, ${failures.length} couldn't be reached`}.
          </p>

          {/* Failures are listed rather than swallowed — a dead feed in an old
              export is common, and people need to know which one to chase. */}
          {failures.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                Show what failed
              </summary>
              <ul className="mt-2 space-y-1.5">
                {failures.map((f) => (
                  <li key={f.feedUrl} className="text-xs">
                    <span className="block truncate text-foreground">{f.feedUrl}</span>
                    <span className="text-subtle-foreground">{f.error}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
