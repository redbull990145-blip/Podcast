"use client";

import { motion } from "motion/react";
import { pageTransition } from "@/lib/motion/variants";

/**
 * Route transition for the authenticated shell.
 *
 * A `template` rather than a `layout` because Next remounts a template on every
 * navigation, which is what gives the incoming page a mount to animate from.
 *
 * It is deliberately restrained. Every page here is server-rendered per
 * request, so a navigation already costs a round trip; a long or sliding
 * transition on top of that is latency the user can feel, dressed up as polish.
 * A 240ms fade with 6px of lift is enough to signal "this is new content"
 * and is over before anyone could have finished reading anyway.
 *
 * No exit animation and no AnimatePresence: the outgoing page's data is already
 * gone by the time this remounts, so there is nothing left to animate out.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div variants={pageTransition} initial="hidden" animate="visible">
      {children}
    </motion.div>
  );
}
