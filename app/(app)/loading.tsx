import { EpisodeListSkeleton, PageShell, Skeleton } from "@/components/ui/page";

/**
 * Shared loading state for every authenticated route without its own.
 *
 * Its real value is not the shimmer: a route segment with a loading boundary
 * gets a static shell Next can prefetch, so tapping a nav item paints the new
 * page instantly instead of sitting on the old one until the server responds.
 */
export default function Loading() {
  return (
    <PageShell>
      <div className="border-b border-border pb-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-3 h-4 w-72" />
      </div>
      <EpisodeListSkeleton />
    </PageShell>
  );
}
