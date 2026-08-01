import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Download,
  Gauge,
  RefreshCw,
  Search,
  Sparkles,
  SquareStack,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo, Wordmark } from "@/components/brand/logo";
import { getUser } from "@/lib/supabase/server";

const FEATURES = [
  {
    Icon: Gauge,
    title: "Playback that actually obeys you",
    body: "Speed from 0.5× to 3× in fine steps — not four coarse presets — with pitch correction, silence skipping and volume boost.",
  },
  {
    Icon: RefreshCw,
    title: "Sync that doesn't lose your place",
    body: "Position and queue push between devices in seconds. Start on your laptop, finish on your phone, mid-sentence.",
  },
  {
    Icon: Sparkles,
    title: "AI show notes and answers",
    body: "Summaries, chapters and a chat you can ask about any episode — every answer links to the exact second it came from.",
  },
  {
    Icon: Search,
    title: "Discovery beyond the top 100",
    body: "Two catalogues plus raw RSS, so independent shows surface instead of drowning under the same handful of hits.",
  },
  {
    Icon: SquareStack,
    title: "A queue you can rearrange",
    body: "Drag, or use the keyboard. Bulk-select episodes, filter by unplayed, downloaded or length, and set rules per show.",
  },
  {
    Icon: Download,
    title: "Yours to take with you",
    body: "One-click OPML export, no paywall on any feature, no ads injected into audio, no third-party trackers watching you listen.",
  },
];

export default async function LandingPage() {
  // Signed-in visitors should land in the app, not on the pitch.
  if (await getUser()) redirect("/home");

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Wordmark />
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">Get started</Button>
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="relative overflow-hidden px-6 pb-24 pt-20 sm:pt-28">
          {/* Ambient accent wash behind the headline. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[32rem] w-[64rem] -translate-x-1/2 rounded-full opacity-[0.18] blur-3xl"
            style={{
              background:
                "radial-gradient(closest-side, var(--accent), transparent 70%)",
            }}
          />

          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground">
              <Logo className="size-3.5 text-accent" />
              Free, ad-free, and export-friendly
            </p>

            <h1 className="text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
              Podcasts, without the
              <span className="text-accent"> compromises</span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
              Every podcast app makes you give something up — your place in an
              episode, control over playback, or the right to leave. This one
              doesn&apos;t.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/signup">
                <Button size="lg" className="w-full sm:w-auto">
                  Start listening
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="secondary" size="lg" className="w-full sm:w-auto">
                  I have an account
                </Button>
              </Link>
            </div>

            <p className="mt-4 text-xs text-subtle-foreground">
              No credit card. AI features included — bring your own API key if you
              want unlimited.
            </p>
          </div>
        </section>

        <section className="border-t border-border bg-surface/40 px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight">
                Built from a list of complaints
              </h2>
              <p className="mt-3 text-muted-foreground">
                Each of these started as something that annoyed us in an app we
                were already paying for.
              </p>
            </div>

            <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ Icon, title, body }) => (
                <li
                  key={title}
                  // Named properties rather than `all`: `all` also transitions
                  // whatever else happens to change on this element, which on a
                  // hover is a promise nobody checked.
                  className="group rounded-2xl border border-border bg-surface p-6 transition-[border-color,box-shadow] duration-200 hover:border-border-strong hover:shadow-[var(--shadow-lifted)]"
                >
                  <span className="grid size-10 place-items-center rounded-xl bg-accent-subtle text-accent">
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <h3 className="mt-4 font-semibold tracking-tight">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="px-6 py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">
              Simple by default. Deep when you want it.
            </h2>
            <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
              The default view is a list of shows and a play button. Flip on power
              mode and you get keyboard shortcuts, bulk actions, per-show playback
              rules and advanced filters. Nothing behind that switch costs extra —
              it exists to keep the app calm, not to sell you an upgrade.
            </p>
            <Link href="/signup" className="mt-8 inline-block">
              <Button size="lg">Create a free account</Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
          <Wordmark />
          <p>Audio streams straight from each show&apos;s publisher. We never touch it.</p>
        </div>
      </footer>
    </div>
  );
}
