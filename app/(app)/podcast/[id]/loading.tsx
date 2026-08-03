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
      {/* Every measurement below is copied from the real header, including the
          negative margin that takes the band up behind the phone's tab bar —
          a skeleton that sits 90px lower than the thing it stands in for is a
          jump, which is the one thing it exists to prevent. */}
      <div
        className={[
          "bg-[radial-gradient(90%_140%_at_8%_0%,#3c5445_0%,#33463a_48%,var(--background)_100%)]",
          "px-5 pb-8 sm:px-10",
          "-mt-[calc(env(safe-area-inset-top)+5.625rem)]",
          "pt-[calc(env(safe-area-inset-top)+5.625rem)]",
          "lg:mt-0 lg:pt-11",
        ].join(" ")}
      >
        <div className="mx-auto flex max-w-[1000px] items-end gap-4 sm:gap-6">
          <Skeleton className="size-28 shrink-0 rounded-[16px] bg-white/10 sm:size-45 sm:rounded-[18px]" />
          <div className="min-w-0 flex-1 space-y-2.5 pb-1 sm:space-y-3">
            <Skeleton className="h-3 w-28 bg-white/10" />
            <Skeleton className="h-7 w-2/3 bg-white/10 sm:h-9" />
            <Skeleton className="h-4 w-40 bg-white/10 sm:w-52" />
            <Skeleton className="hidden h-10 w-32 rounded-app bg-white/10 sm:block" />
          </div>
        </div>

        <div className="mx-auto mt-4 flex max-w-[1000px] gap-2.5 sm:hidden">
          <Skeleton className="h-11 flex-1 rounded-app-md bg-white/10" />
          <Skeleton className="h-11 w-28 rounded-app-md bg-white/10" />
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
