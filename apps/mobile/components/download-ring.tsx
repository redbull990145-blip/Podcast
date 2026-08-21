import { useEffect } from 'react';
import type { ColorValue } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

export const RING_SIZE = 34;
const STROKE = 2;
const RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * How far a download has got, drawn around its button.
 *
 * Two modes, because publishers hand us two situations. When a `Content-Length`
 * arrived, the arc is the real fraction and needs no animation of its own — the
 * bytes *are* the animation, and a spring smoothing between samples would draw
 * a number that is not true.
 *
 * When the length is unknown the arc cannot mean anything, so it spins instead.
 * An arc frozen near zero reads as a stalled download; a spinner reads as
 * "working, length unknown", which is exactly the situation.
 */
export function DownloadRing({
  progress,
  color,
}: {
  /** 0–1, or null when the publisher sent no length. */
  progress: number | null;
  color: ColorValue;
}) {
  const reduced = useReducedMotion();
  const spin = useSharedValue(0);
  const fade = useSharedValue(1);

  const indeterminate = progress === null;

  useEffect(() => {
    if (!indeterminate) return;

    if (reduced) {
      // Rotation is travel, and travel is what reduced motion takes away. A
      // slow breath still says "working" without moving anything across the
      // screen — and opacity is the one channel the policy always keeps.
      // 1.2s easeInOut mirrors the web LoadingRing's reduced branch.
      fade.value = withRepeat(
        withTiming(0.35, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      return;
    }

    // 0.9s linear turn, matching the web LoadingRing (controls.tsx) so both
    // platforms read as the same spinner.
    spin.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
  }, [indeterminate, reduced, spin, fade]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
    opacity: fade.value,
  }));

  // A quarter turn for the indeterminate case: enough to read as movement,
  // short enough that nobody could mistake it for real progress.
  const filled = indeterminate ? 0.25 : Math.max(0.04, progress);

  return (
    <Animated.View style={[styles.overlay, animated]} pointerEvents="none">
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - filled)}
          // Start at twelve o'clock rather than three, which is where every
          // progress ring anyone has ever seen begins.
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </Svg>
    </Animated.View>
  );
}

/** The track the arc runs on, so a barely-started download is still a ring. */
export function DownloadTrack({ color }: { color: ColorValue }) {
  return (
    <Svg width={RING_SIZE} height={RING_SIZE} style={styles.overlay} pointerEvents="none">
      <Circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RADIUS}
        stroke={color}
        strokeWidth={STROKE}
        fill="none"
        opacity={0.25}
      />
    </Svg>
  );
}

const styles = { overlay: { position: 'absolute' } } as const;
