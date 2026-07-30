"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Compass, Loader2, Plus, Rss, Sparkles, X } from "lucide-react";
import type { Recommendation } from "@/lib/recommender/score-candidates";
import { Button } from "@/components/ui/button";
import { stripHtml } from "@/lib/utils";

type Response = {
  recommendations: Recommendation[];
  categories: string[];
  coldStart: boolean;
};

/**
 * Recommendations, each carrying the reason it was chosen.
 *
 * The reasons are not decoration: they are the actual top contributors to the
 * score, rendered from the same numbers that produced the ranking. That is the
 * direct answer to not knowing why an app is showing you something.
 */
export function RecommendationsPanel() {
  const { data, isPending, isError } = useQuery<Response>({
    queryKey: ["recommendations"],
    queryFn: async () => {
      const res = await fetch("/api/recommendations");
      if (!res.ok) throw new Error("Couldn't load recommendations.");
      return res.json();
    },
    // Recomputed from a live catalogue search; no need to redo it on every visit.
    staleTime: 10 * 60_000,
  });

  if (isPending) {
    return (
      <div className="grid place-items-center py-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (isError) return null;

  if (data.coldStart) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/50 p-6 text-center">
        <span className="mx-auto grid size-10 place-items-center rounded-full bg-accent-subtle text-accent">
          <Compass className="size-5" />
        </span>
        <h3 className="mt-3 text-sm font-semibold">No recommendations yet</h3>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
          Follow a few shows or finish an episode, and suggestions will appear
          here — each one showing exactly which of your listening habits it came
          from.
        </p>
      </div>
    );
  }

  if (data.recommendations.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-3">
        <h2 className="flex items-center gap-2 font-semibold tracking-tight">
          <Sparkles className="size-4 text-accent" />
          Suggested for you
        </h2>
        <span className="text-xs text-subtle-foreground">
          From your {formatList(data.categories.slice(0, 3))} listening
        </span>
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {data.recommendations.map((rec) => (
          <RecommendationCard key={rec.feedUrl} rec={rec} />
        ))}
      </ul>

      <p className="mt-4 text-[11px] leading-relaxed text-subtle-foreground">
        Ranked on this device from your own listening history — no external
        service is asked what you might like, and nothing about you is sent
        anywhere to produce this list.
      </p>
    </section>
  );
}

function formatList(items: string[]): string {
  if (items.length === 0) return "recent";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "adding" | "added" | "error">("idle");
  const [dismissed, setDismissed] = useState(false);

  async function subscribe() {
    setState("adding");
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          feedUrl: rec.feedUrl,
          itunesId: rec.itunesId,
          podcastindexId: rec.podcastindexId,
        }),
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      setState("added");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  async function dismiss() {
    // Hide it straight away; persisting is best-effort and must not block the
    // interaction that the person clearly meant.
    setDismissed(true);
    try {
      await fetch("/api/recommendations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          feedUrl: rec.feedUrl,
          title: rec.title,
          author: rec.author,
          artworkUrl: rec.artworkUrl,
          categories: rec.categories,
          signal: "not_interested",
        }),
      });
      void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    } catch {
      // Leaving it hidden for this session is still the right outcome.
    }
  }

  if (dismissed) return null;

  return (
    <li className="flex gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-strong">
      {rec.artworkUrl ? (
        <Image
          src={rec.artworkUrl}
          alt=""
          width={128}
          height={128}
          sizes="64px"
          className="size-16 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-accent-subtle text-accent">
          <Rss className="size-6" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold">{rec.title}</h3>
          <button
            onClick={dismiss}
            aria-label={`Not interested in ${rec.title}`}
            title="Not interested"
            className="-mr-1 -mt-1 grid size-7 shrink-0 place-items-center rounded-lg text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {rec.author && (
          <p className="truncate text-xs text-muted-foreground">{rec.author}</p>
        )}

        {rec.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-subtle-foreground">
            {stripHtml(rec.description)}
          </p>
        )}

        <ul className="mt-2 space-y-0.5">
          {rec.reasons.map((reason) => (
            <li
              key={reason.category}
              className="flex items-start gap-1.5 text-[11px] leading-snug text-accent"
            >
              <span aria-hidden className="mt-[3px] block size-1 shrink-0 rounded-full bg-accent" />
              {reason.label}
            </li>
          ))}
        </ul>

        <div className="mt-2.5">
          <Button
            size="sm"
            variant={state === "added" ? "secondary" : "primary"}
            onClick={subscribe}
            disabled={state === "adding" || state === "added"}
          >
            {state === "adding" && <Loader2 className="size-3.5 animate-spin" />}
            {state === "added" ? (
              <>
                <Check className="size-3.5" /> Following
              </>
            ) : state === "adding" ? (
              "Adding…"
            ) : (
              <>
                <Plus className="size-3.5" /> Follow
              </>
            )}
          </Button>
        </div>
      </div>
    </li>
  );
}
