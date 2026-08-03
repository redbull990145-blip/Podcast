"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Check, Loader2, Plus, Rss, Search } from "lucide-react";
import type { PodcastSearchResult } from "@/lib/podcasts/search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/page";
import { liftCard, pressSubtle } from "@/lib/motion/gestures";
import { listContainer, listItem } from "@/lib/motion/variants";
import { assertSafeFeedUrl, UnsafeUrlError } from "@/lib/rss/url-guard";
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
    <div className="space-y-7">
      <div>
        {/*
          Set large, on the page's tallest control. Search is the only thing
          anyone comes to this screen to do, so it gets the weight rather than
          sharing it with a row of filters above it.
        */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-[18px] top-1/2 size-[18px] -translate-y-1/2 text-subtle"
            strokeWidth={1.9}
          />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search podcasts…"
            aria-label="Search podcasts"
            className="h-14 rounded-app-lg border-border-strong pl-12 text-[16.5px] shadow-[var(--shadow-soft)]"
            autoFocus
          />
          {isFetching && (
            <Loader2 className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-subtle" />
          )}
        </div>

        <CategoryChips onPick={setTerm} />

        {debounced.length >= 2 && data && data.results.length === 0 && !isFetching && (
          <p className="mt-4 text-sm text-muted">
            Nothing found for “{debounced}”. If you have the show&apos;s RSS URL,
            paste it below — it&apos;ll work even when the catalogues don&apos;t
            list it.
          </p>
        )}

        {data && data.results.length > 0 && (
          <>
            <SectionLabel className="mt-8">
              {data.results.length} result{data.results.length === 1 ? "" : "s"}
            </SectionLabel>
            <motion.ul
              variants={listContainer}
              initial="hidden"
              animate="visible"
              // Results are keyed on the query, so a new search re-runs the
              // stagger instead of silently swapping the contents of the old one.
              key={debounced}
              className="mt-3.5 grid gap-3.5 lg:grid-cols-2"
            >
              {data.results.map((result) => (
                <SearchResultCard
                  key={result.feedUrl}
                  result={result}
                  alreadySubscribed={subscribed.has(result.feedUrl)}
                />
              ))}
            </motion.ul>
          </>
        )}
      </div>

      <AddByRss />
    </div>
  );
}

/**
 * Starting points, for arriving with nothing in mind.
 *
 * They write into the search field rather than filtering results, because the
 * catalogues these query are searched by term, not browsed by taxonomy — a chip
 * that looked like a filter but behaved like a query would be a lie about what
 * the button does.
 */
const CATEGORIES = [
  "Documentary",
  "Interview",
  "Design",
  "Science",
  "Writing",
  "Cities",
  "Sound",
];

function CategoryChips({ onPick }: { onPick: (term: string) => void }) {
  return (
    /*
     * One scrolling line on a phone, wrapped from `sm`.
     *
     * Seven chips wrap to three rows at 402px, which puts about 130px of
     * starting points between the search field and the results — on the screen
     * where the results are the point. Sideways they cost one 38px line, and
     * the row is cut off at the edge, which says there are more of them better
     * than a third row of them does.
     *
     * `flex-nowrap` is a utility so it beats `.card-scroller`'s own display in
     * the components layer; `sm:flex-wrap` hands it back along with the bleed.
     */
    <div className="card-scroller -mx-5 mt-4 flex-nowrap gap-2 scroll-pl-5 px-5 py-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:scroll-pl-0">
      {CATEGORIES.map((category) => (
        <motion.button
          {...pressSubtle}
          key={category}
          onClick={() => onPick(category)}
          className="shrink-0 rounded-full bg-surface-raised px-3.5 py-2 text-[12.5px] font-medium text-ink-4 transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          {category}
        </motion.button>
      ))}
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
    <motion.li
      variants={listItem}
      {...liftCard}
      className="flex gap-3.5 rounded-app-lg border border-border-2 bg-surface p-4 transition-colors hover:border-border-strong"
    >
      {result.artworkUrl ? (
        <Image
          src={result.artworkUrl}
          alt=""
          width={136}
          height={136}
          sizes="68px"
          className="size-17 shrink-0 rounded-[13px] object-cover shadow-[0_4px_12px_rgb(34_32_29_/_0.14)]"
        />
      ) : (
        <span className="grid size-17 shrink-0 place-items-center rounded-[13px] bg-accent-subtle text-accent">
          <Rss className="size-6" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate text-sm font-semibold">{result.title}</h3>
          {/* Provenance: shows which catalogue surfaced this, so a result found
              only on PodcastIndex is visibly an indie find rather than noise. */}
          {result.sources.includes("podcastindex") &&
            !result.sources.includes("itunes") && (
              <span className="shrink-0 rounded-full bg-clay-subtle px-2 py-0.5 text-[10px] font-semibold text-clay-ink">
                Indie index
              </span>
            )}
        </div>
        {result.author && (
          <p className="mt-1 truncate text-xs text-subtle-2">{result.author}</p>
        )}
        {result.description && (
          <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-2">
            {stripHtml(result.description)}
          </p>
        )}
        <div className="mt-3">
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
        {message && <p className="mt-2 text-xs text-danger">{message}</p>}
      </div>
    </motion.li>
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

    /*
     * Checked here as well as on the server, and not for security — the server
     * never trusts this — but for the message. The same function runs on both
     * sides, so an address that is genuinely unusable is named as such
     * ("must start with http:// or https://", "that address isn't reachable")
     * without a round trip, and one that is merely missing its scheme is
     * completed rather than refused.
     */
    let feedUrl: string;
    try {
      feedUrl = assertSafeFeedUrl(url).toString();
    } catch (err) {
      setError(
        err instanceof UnsafeUrlError ? err.message : "That doesn't look like a valid URL.",
      );
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feedUrl }),
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
    <section className="rounded-app-lg border border-border bg-surface-sunken p-5.5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-accent-subtle text-accent">
          <Rss className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[14.5px] font-semibold">Add any feed directly</h2>
          <p className="mt-1.5 max-w-[64ch] text-[12.5px] leading-relaxed text-muted-2">
            Paste an RSS URL to follow a show that isn&apos;t in either
            catalogue. Private feeds and self-hosted shows work the same as any
            other.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
        {/*
          Deliberately not `type="url"`. That hands validation to the browser,
          which refuses anything without a scheme and says so in a bubble we
          cannot word — "Please enter a URL" for `blog.example.org/feed`, which
          is both wrong and unactionable. As a plain text field the value
          reaches `submit`, where a missing scheme is filled in and only a
          genuinely bad address produces an error, in our own words.

          `inputMode` and `autoComplete` are what `type="url"` was really
          earning: a keyboard with a slash on it, and the browser's own list of
          addresses.
        */}
        <Input
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            // Clear a stale complaint as soon as they start fixing it.
            if (error) setError(null);
          }}
          placeholder="example.com/feed.xml"
          aria-label="RSS feed URL"
          aria-invalid={error ? true : undefined}
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
