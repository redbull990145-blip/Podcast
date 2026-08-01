"use client";

import Link from "next/link";
import { motion } from "motion/react";

/**
 * `next/link` that accepts Motion's gesture props.
 *
 * Navigation targets need the same press feedback as buttons — a card or a
 * search field that happens to be a link should still yield under the finger.
 * Wrapping here rather than in each call site keeps one wrapped component in
 * the tree instead of a new one per module, which matters because Motion
 * treats each wrapper as a distinct component type.
 *
 * Spread a bundle from lib/motion/gestures onto it: `<MotionLink {...pressSubtle} />`.
 */
export const MotionLink = motion.create(Link);
