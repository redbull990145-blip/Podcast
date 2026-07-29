"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ListPlus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Adds an episode to Up Next. `placement="next"` jumps it to the front. */
export function QueueButton({
  episodeId,
  placement = "last",
  variant = "icon",
  className,
}: {
  episodeId: string;
  placement?: "next" | "last";
  variant?: "icon" | "labelled";
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");

  async function add() {
    setState("adding");
    try {
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ episodeId, placement }),
      });
      if (!res.ok) {
        setState("idle");
        return;
      }
      setState("added");
      void queryClient.invalidateQueries({ queryKey: ["queue"] });
      // Reset so the control stays usable if they remove it from the queue and
      // want to add it back.
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("idle");
    }
  }

  const label = placement === "next" ? "Play next" : "Add to Up Next";

  if (variant === "labelled") {
    return (
      <button
        onClick={add}
        disabled={state !== "idle"}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-[var(--radius-app)] border border-border bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-hover disabled:opacity-60",
          className,
        )}
      >
        {state === "adding" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : state === "added" ? (
          <Check className="size-4 text-success" />
        ) : (
          <ListPlus className="size-4" />
        )}
        {state === "added" ? "Queued" : label}
      </button>
    );
  }

  return (
    <button
      onClick={add}
      disabled={state !== "idle"}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-8 place-items-center rounded-lg text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-foreground",
        className,
      )}
    >
      {state === "adding" ? (
        <Loader2 className="size-4 animate-spin" />
      ) : state === "added" ? (
        <Check className="size-4 text-success" />
      ) : (
        <ListPlus className="size-4" />
      )}
    </button>
  );
}
