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
        <h1 className="text-[26px] font-semibold -tracking-[0.03em] sm:text-[30px]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 text-sm text-muted sm:text-[14px]">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * The measure every screen is set to.
 *
 * 1000px, which is narrower than the window on most desktops and deliberately
 * so: the widest thing here is a five-across grid of square covers, and letting
 * that track the viewport pushes covers past the size where the artwork is
 * legible while stretching every title line beyond a comfortable measure. The
 * page is centred in whatever space is left.
 */
export function PageShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-[1000px] px-5 py-8 sm:px-10 sm:py-11", className)}>
      {children}
    </div>
  );
}

/** Small uppercase label above a group. Used as a section rule throughout. */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[11.5px] font-semibold uppercase tracking-[0.1em] text-subtle-2",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * Three-bar level meter marking what is currently playing.
 *
 * Hidden from assistive technology: it is a decorative restatement of state
 * that the row already carries in text, and announcing "image" beside every
 * playing item is noise.
 */
export function PlayingBars({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("flex h-3.5 items-end gap-[2px]", className)}>
      <span className="eq-bar block h-full w-[2.5px] rounded-full bg-accent" />
      <span className="eq-bar block h-full w-[2.5px] rounded-full bg-accent" />
      <span className="eq-bar block h-full w-[2.5px] rounded-full bg-accent" />
    </span>
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
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  /** For per-instance widths, which would otherwise need a class each. */
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={cn("skeleton rounded-app bg-surface-raised", className)}
      style={style}
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
    <div className="flex flex-col items-center justify-center rounded-app-xl border border-dashed border-border-strong px-6 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-app-lg bg-accent-subtle text-accent">
        <Icon className="size-6" strokeWidth={1.75} />
      </span>
      <h2 className="mt-4 font-semibold -tracking-[0.01em]">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
