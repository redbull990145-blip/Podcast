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

/** Three-way segmented control. "System" is a real option, not a hidden default. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5"
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
              "relative grid size-7 place-items-center rounded-full transition-colors",
              active
                ? "text-accent-foreground"
                : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {/* The selected disc slides across the three options. */}
            {active && (
              <motion.span
                layoutId="theme-selected"
                aria-hidden
                transition={SPRING.pop}
                className="absolute inset-0 -z-10 rounded-full bg-accent"
              />
            )}
            <Icon className="size-3.5" strokeWidth={2} />
          </motion.button>
        );
      })}
    </div>
  );
}
