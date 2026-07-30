import Link from "next/link";
import type { Metadata } from "next";
import { CloudOff } from "lucide-react";

export const metadata: Metadata = { title: "Offline" };

/**
 * Shown when a navigation is attempted with no connection and no cached copy.
 *
 * Deliberately static so the service worker can precache it — a fallback that
 * needs the network to render is not a fallback. It points at Downloads,
 * because that is the one part of the app that genuinely works offline.
 */
export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-subtle text-accent">
          <CloudOff className="size-7" strokeWidth={1.75} />
        </span>

        <h1 className="mt-5 text-xl font-semibold tracking-tight">You&apos;re offline</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This page needs a connection. Anything you downloaded is still on this
          device and plays without one.
        </p>

        <Link
          href="/downloads"
          className="mt-6 inline-flex h-11 items-center rounded-[var(--radius-app)] bg-accent px-5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
        >
          Go to Downloads
        </Link>
      </div>
    </main>
  );
}
