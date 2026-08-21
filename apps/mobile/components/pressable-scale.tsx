import { pressScale, spring, springRest } from "@cue/motion";
import type { ReactNode } from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

// Created once at module level — building this per render would remount the
// animated component identity every frame budget and drop the worklet.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<PressableProps, "children"> & {
  /**
   * Resting scale at full press. Passed through pressScale(), so under
   * reduced motion it shallows to the shared policy cap instead of
   * disappearing — the squash still answers "did that land?".
   */
  scale?: number;
  /** Which spring token drives the squash-and-release. */
  springToken?: "responsive" | "snappy";
  children?: ReactNode;
};

/**
 * Press feedback for the controls that would otherwise have none.
 *
 * Primary CTAs are hand-built (Button owns its own hook); everything else —
 * rows, cards, icon buttons, the long tail of secondary targets — sat dead.
 * On a touchscreen there is no cursor and no hover state to answer "did that
 * register?" before the tap lands, so a silent control does not read as
 * understated, it reads as broken. This wraps Pressable and adds the one
 * animation that answers the question: a shallow squash toward the finger.
 *
 * Reach for it on any tappable surface that is not a full Button. Leave a
 * control alone when it already answers the press another way — a repaint on
 * state change, a screen that visibly moves — scale stacked on visible
 * feedback is garnish, and garnish on everything reads as noise.
 *
 * Mechanically, the springs drive a single 0..1 progress value and scale and
 * opacity are lerped off it inside the worklet. No spring ever animates
 * opacity itself, so there is nothing to clamp: both outputs are linear
 * blends between two fixed endpoints and stay bounded by construction. The
 * spring's slight overshoot can only nudge the squash depth a fraction past
 * its floor — which is precisely the rebound that makes a released control
 * feel alive rather than drawn.
 *
 * The 8% opacity dip matches Button exactly, so every press in the app dims
 * by the same amount and the surfaces feel like one material.
 */
export function PressableScale({
  scale = 0.96,
  springToken: token = "responsive",
  children,
  style,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);

  // Same policy as Button: reduced motion shallows the squash rather than
  // removing it — the depth decision lives in @cue/motion so web and Android
  // agree on how far a press goes and neither component remembers a number.
  const depth = pressScale(scale, Boolean(reduced));

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - depth) }],
    opacity: 1 - pressed.value * 0.08,
  }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event: GestureResponderEvent) => {
        pressed.value = withSpring(1, { ...spring[token], ...springRest });
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        pressed.value = withSpring(0, { ...spring[token], ...springRest });
        onPressOut?.(event);
      }}
      style={
        typeof style === "function"
          ? (state: { readonly pressed: boolean }) => [style(state), animated]
          : [style, animated]
      }
    >
      {children}
    </AnimatedPressable>
  );
}
