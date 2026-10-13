import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

/** Prefetched with the shell, so uncached routes respond before the server does. */
export default function AppLoading() {
  return (
    <PageShell>
      <div aria-busy="true" data-route-loading="" className="flex flex-col gap-8">
        <Skeleton w="42%" h={38} />
        <Skeleton w="65%" h={18} />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} h={180} shape="block" className="w-full" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}
