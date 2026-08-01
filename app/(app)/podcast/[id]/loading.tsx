import { EpisodeListSkeleton, PageShell, Skeleton } from "@/components/ui/page";

/**
 * Mirrors the show page's tinted-header-plus-episode-list shape to avoid a
 * layout jump.
 *
 * The header band is the real gradient rather than a placeholder block. It
 * depends on nothing the server is still fetching, so painting it immediately
 * means the page arrives at its final shape and only the text inside it fills
 * in — which reads as loading rather than as rebuilding.
 */
export default function Loading() {
  return (
    <>
      <div className="bg-[radial-gradient(90%_140%_at_8%_0%,#3c5445_0%,#33463a_48%,var(--background)_100%)] px-5 pb-8 pt-9 sm:px-10 sm:pt-11">
        <div className="mx-auto flex max-w-[1000px] flex-col gap-5 sm:flex-row sm:items-end sm:gap-6">
          <Skeleton className="size-32 shrink-0 rounded-[18px] bg-white/10 sm:size-45" />
          <div className="min-w-0 flex-1 space-y-3 pb-1.5">
            <Skeleton className="h-3 w-28 bg-white/10" />
            <Skeleton className="h-9 w-2/3 bg-white/10" />
            <Skeleton className="h-4 w-52 bg-white/10" />
            <Skeleton className="h-10 w-32 rounded-app bg-white/10" />
          </div>
        </div>
      </div>

      <PageShell className="pt-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>

        <section className="mt-7">
          <div className="flex items-baseline justify-between border-b border-border pb-3.5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
          <EpisodeListSkeleton rows={8} />
        </section>
      </PageShell>
    </>
  );
}
