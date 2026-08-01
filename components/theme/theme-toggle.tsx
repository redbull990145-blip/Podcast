"use client";

import { motion } from "motion/react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type Theme } from "./theme-provider";
import { SPRING } from "@/lib/motion/config";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/**
 * Three-way segmented control. "System" is a real option, not a hidden default.
 *
 * The selected option is marked by a raised plate rather than by a filled
 * accent disc. This sits inside the glass top bar, where a saturated accent
 * chip would be the loudest thing on the page and compete with the artwork —
 * and it reads as a physical switch, which a coloured dot does not.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-app border border-border-strong bg-glass-pill p-[3px] shadow-[inset_0_1px_0_var(--glass-highlight)]",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <motion.button
            key={value}
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            whileTap={{ scale: 0.9 }}
            transition={SPRING.snappy}
            className={cn(
              "relative grid size-[30px] place-items-center rounded-[9px] transition-colors",
              active ? "text-ink-2" : "text-ink-4 hover:text-foreground",
            )}
          >
            {/* The plate slides across the three options rather than blinking
                out under one and in under the next. */}
            {active && (
              <motion.span
                layoutId="theme-selected"
                aria-hidden
                transition={SPRING.pop}
                className="absolute inset-0 -z-10 rounded-[9px] bg-surface shadow-[0_1px_2px_rgb(34_32_29_/_0.1)]"
              />
            )}
            <Icon className="size-3.5" strokeWidth={1.9} />
          </motion.button>
        );
      })}
    </div>
  );
}
