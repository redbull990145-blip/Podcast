"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Plus, Rss, Search } from "lucide-react";
import type { PodcastSearchResult } from "@/lib/podcasts/search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, stripHtml } from "@/lib/utils";

/**
 * Search across both catalogues, plus a first-class "add by RSS" field.
 *
 * The RSS field is visible by default rather than tucked into a menu: being
 * able to add any feed is the whole point of an open podcast app, and burying
 * it is how the big apps quietly steer people into their own catalogue.
 */
export function DiscoverPanel({
  subscribedFeedUrls,
}: {
  subscribedFeedUrls: string[];
}) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 350);
    return () => clearTimeout(t);
  }, [term]);

  const { data, isFetching } = useQuery({
    queryKey: ["podcast-search", debounced],
    enabled: debounced.length >= 2,
    queryFn: async () => {
      const res = await fetch(`/api/podcasts/search?q=${encodeURIComponent(debounced)}`);
      if (!res.ok) throw new Error("Search failed");
      return (await res.json()) as { results: PodcastSearchResult[] };
    },
  });

  const subscribed = new Set(subscribedFeedUrls);

  return (
    <div className="space-y-8">
      <div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search podcasts…"
            aria-label="Search podcasts"
            className="h-12 pl-9 text-base"
            autoFocus
          />
          {isFetching && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-subtle-foreground" />
          )}
        </div>

        {debounced.length >= 2 && data && data.results.length === 0 && !isFetching && (
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing found for “{debounced}”. If you have the show&apos;s RSS URL,
            paste it below — it&apos;ll work even when the catalogues don&apos;t
            list it.
          </p>
        )}

        {data && data.results.length > 0 && (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {data.results.map((result) => (
              <SearchResultCard
                key={result.feedUrl}
                result={result}
                alreadySubscribed={subscribed.has(result.feedUrl)}
              />
            ))}
          </ul>
        )}
      </div>

      <AddByRss />
    </div>
  );
}

function SearchResultCard({
  result,
  alreadySubscribed,
}: {
  result: PodcastSearchResult;
  alreadySubscribed: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "adding" | "added" | "error">(
    alreadySubscribed ? "added" : "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  async function subscribe() {
    setState("adding");
    setMessage(null);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          feedUrl: result.feedUrl,
          itunesId: result.itunesId,
          podcastindexId: result.podcastindexId,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setState("error");
        setMessage(body.error ?? "Couldn't subscribe.");
        return;
      }
      setState("added");
      router.refresh();
    } catch {
      setState("error");
      setMessage("Couldn't reach the server.");
    }
  }

  return (
    <li className="flex gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-strong">
      {result.artworkUrl ? (
        <Image
          src={result.artworkUrl}
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
        <h3 className="truncate text-sm font-semibold">{result.title}</h3>
        {result.author && (
          <p className="truncate text-xs text-muted-foreground">{result.author}</p>
        )}
        {result.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-subtle-foreground">
            {stripHtml(result.description)}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
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
          {/* Provenance: shows which catalogue surfaced this, so a result found
              only on PodcastIndex is visibly an indie find rather than noise. */}
          {result.sources.includes("podcastindex") &&
            !result.sources.includes("itunes") && (
              <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-medium text-accent">
                Indie index
              </span>
            )}
        </div>
        {message && <p className="mt-1.5 text-xs text-danger">{message}</p>}
      </div>
    </li>
  );
}

function AddByRss() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);

    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feedUrl: url.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't add that feed.");
        return;
      }
      setSuccess(`Added “${body.podcast.title}”.`);
      setUrl("");
      startTransition(() => router.refresh());
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-subtle text-accent">
          <Rss className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Add any feed directly</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Paste an RSS URL to follow a show that isn&apos;t in either
            catalogue. Private feeds and self-hosted shows work the same as any
            other.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/feed.xml"
          aria-label="RSS feed URL"
          required
          className={cn("flex-1", error && "border-danger")}
        />
        <Button type="submit" disabled={busy || pending || !url.trim()}>
          {(busy || pending) && <Loader2 className="size-4 animate-spin" />}
          Add feed
        </Button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mt-2 text-xs text-success">
          {success}
        </p>
      )}
    </section>
  );
}
