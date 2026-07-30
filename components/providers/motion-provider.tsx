"use client";

import { MotionConfig } from "motion/react";

/**
 * App-wide motion defaults.
 *
 * `reducedMotion="user"` is the important part: with it set, every Motion
 * component in the tree automatically drops transform and layout animation when
 * the OS asks for reduced motion, while still allowing opacity to cross-fade.
 * That is the right reading of the setting — people who enable it are avoiding
 * vestibular triggers from things flying around, not asking for the interface to
 * change state invisibly.
 *
 * No default `transition` is set on purpose. Motion already picks per-value
 * defaults — springs for transforms, tweens for colour and opacity — and
 * flattening that to one curve would put a spring on opacity, which reads as a
 * flicker. Components that want something specific pull it from lib/motion.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
