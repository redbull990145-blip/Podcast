"use client";

import { motion } from "motion/react";
import { cascade, dashboardBlock } from "@/lib/motion/variants";

/**
 * One block of Home's entrance cascade, for blocks with nothing animated inside
 * them.
 *
 * Home is an async server component and cannot hold a `motion` element, so this
 * is the client boundary for the parts of the page that are otherwise static
 * markup — currently just the greeting. Everything else on Home already had a
 * component that knew how to enter (`ResumeHero`, `ContinueRow`, `StatCards`);
 * those take a `delay` instead, so nothing is wrapped that did not need
 * wrapping.
 *
 * It takes the className the layout already had and becomes the same grid item,
 * so none of the two-column structure moves into the client bundle — only the
 * props that make it animate.
 *
 * `index` rather than a raw delay so the call sites read as positions in a
 * sequence, and so re-ordering the page is a re-numbering rather than a
 * re-timing. See `cascade` for why this is a delay and not `staggerChildren`.
 */
export function CascadeBlock({
  children,
  className,
  index,
}: {
  children: React.ReactNode;
  className?: string;
  index: number;
}) {
  return (
    <motion.div
      variants={dashboardBlock}
      custom={cascade(index)}
      initial="hidden"
      animate="visible"
      className={className}
    >
      {children}
    </motion.div>
  );
}
