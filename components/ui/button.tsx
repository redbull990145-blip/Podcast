"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import { SPRING } from "@/lib/motion/config";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-foreground hover:bg-accent-hover shadow-[var(--shadow-soft)]",
  secondary:
    "bg-surface text-foreground border border-border hover:bg-surface-hover hover:border-border-strong",
  ghost: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
  danger: "bg-danger text-white hover:opacity-90",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
  icon: "size-10 p-0",
};

export type ButtonProps = HTMLMotionProps<"button"> & {
  variant?: Variant;
  size?: Size;
};

/**
 * The press is the whole point.
 *
 * A button that only changes colour on hover feels like a web page; one that
 * yields under the finger feels like an app. The numbers are deliberately
 * small — 2.5% down on press, 1% up on hover — because at this size anything
 * larger stops reading as "responsive" and starts reading as "bouncy".
 *
 * Colour still transitions in CSS. Only transform is handed to Motion, so the
 * press stays a compositor-only change no matter what else the page is doing.
 */
export function Button({
  className,
  variant = "primary",
  size = "md",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <motion.button
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.01 }}
      whileTap={disabled ? undefined : { scale: 0.975 }}
      transition={SPRING.snappy}
      className={cn(
        "inline-flex items-center justify-center rounded-[var(--radius-app)] font-medium",
        "transition-colors duration-150",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
