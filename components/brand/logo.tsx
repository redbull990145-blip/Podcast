import { cn } from "@/lib/utils";

/**
 * Waveform mark. The bars step up and back down so it reads as an audio level
 * meter at any size, including a 16px favicon.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-6", className)}
    >
      <rect x="2" y="10" width="2.6" height="4" rx="1.3" fill="currentColor" opacity="0.45" />
      <rect x="6.6" y="7" width="2.6" height="10" rx="1.3" fill="currentColor" opacity="0.7" />
      <rect x="11.2" y="3.5" width="2.6" height="17" rx="1.3" fill="currentColor" />
      <rect x="15.8" y="7" width="2.6" height="10" rx="1.3" fill="currentColor" opacity="0.7" />
      <rect x="20.4" y="10" width="2.6" height="4" rx="1.3" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Logo className="size-5 text-accent" />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">
        Cadence
      </span>
    </span>
  );
}
