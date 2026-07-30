import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function PageShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-5xl px-5 py-6 sm:px-8 sm:py-8", className)}>
      {children}
    </div>
  );
}

/**
 * Placeholder block used by route loading states.
 *
 * Every page here is server-rendered per request, so a navigation cannot show
 * anything until the server answers. A skeleton lets Next paint the new route
 * immediately — and, because a route with a loading boundary has a
 * prefetchable static shell, the transition starts before the click resolves.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-lg bg-surface-raised", className)}
    />
  );
}

/** Rows of shimmering placeholders, shaped like an episode list. */
export function EpisodeListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="mt-2 space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-start gap-3 px-3 py-3.5">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({
  Icon,
  title,
  description,
  action,
}: {
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-accent-subtle text-accent">
        <Icon className="size-6" strokeWidth={1.75} />
      </span>
      <h2 className="mt-4 font-semibold tracking-tight">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
