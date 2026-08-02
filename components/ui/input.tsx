import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * `py-[9px]` is not decoration — it is the whole vertical centring.
 *
 * Preflight zeroes the UA's `padding-block` on inputs, so this had `height:
 * 40px` and no vertical padding at all, and the text landed in the middle only
 * because a browser centres an input's inner text box inside whatever height
 * it is given. That is a rendering behaviour rather than a stated rule, and it
 * is not identical across engines — Safari biases the inner box upward, which
 * is where the off-centre look comes from.
 *
 * The three figures have to agree or the fixed height silently wins and the
 * padding does nothing: 9 + 20 (the `text-sm` line box) + 9, plus 2 for the
 * borders, is exactly the 40px of `h-10`. Changing the type size here means
 * changing the padding with it.
 */
export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-[var(--radius-app)] border border-border bg-surface px-3 py-[9px]",
        "text-sm text-foreground placeholder:text-subtle-foreground",
        "transition-colors hover:border-border-strong",
        "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}
