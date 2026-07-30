import { EpisodeListSkeleton, PageShell, Skeleton } from "@/components/ui/page";

/** Mirrors the show page's header-plus-episode-list shape to avoid a layout jump. */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 sm:flex-row sm:gap-6">
        <Skeleton className="size-32 shrink-0 rounded-2xl sm:size-44" />
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-10 w-32 rounded-[var(--radius-app)]" />
        </div>
      </header>

      <div className="mt-6 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>

      <section className="mt-8">
        <div className="flex items-baseline justify-between border-b border-border pb-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <EpisodeListSkeleton rows={8} />
      </section>
    </PageShell>
  );
}
