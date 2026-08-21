import { formatTimestamp } from '@cue/core';
import { duration, easing, spring, springRest } from '@cue/motion';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { radius, space, type, useTheme } from '@/theme';

const TRACK_HEIGHT = 4;
const KNOB_SIZE = 16;

/**
 * How often the engine reports position. The tween spans exactly this, so the
 * bar arrives at each new reading just as the next one lands — any shorter and
 * it stalls before catching up, any longer and it runs behind.
 */
const POSITION_INTERVAL_MS = 500;

/**
 * The scrubber.
 *
 * The engine reports position twice a second — accurate, but visibly steppy if
 * drawn literally. So each report starts a linear tween to the new position
 * over exactly the interval until the next one, and the bar advances smoothly
 * on the UI thread between reports rather than jumping on each.
 *
 * Linear, specifically: this is a clock, and a clock that eases is a clock
 * that is wrong in the middle.
 *
 * While a drag is in progress the tween is not applied, so the knob follows
 * the finger rather than fighting it — a scrubber that snaps back to the
 * playhead mid-drag is the classic version of this bug.
 */
export function Scrubber({
  positionSec,
  durationSec,
  onSeek,
}: {
  positionSec: number;
  durationSec: number | null;
  onSeek: (seconds: number) => void;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);

  /** 0–1 along the track. */
  const fraction = useSharedValue(0);
  const dragging = useSharedValue(false);
  const knobScale = useSharedValue(0);

  /** Mirrors `durationSec` onto the UI thread, where the callback runs. */
  const total = useSharedValue(durationSec ?? 0);
  useEffect(() => {
    total.value = durationSec ?? 0;
  }, [durationSec, total]);

  /** Where the finger is, while it is down. Null the rest of the time. */
  const [scrubSec, setScrubSec] = useState<number | null>(null);

  /**
   * The last whole second handed to React.
   *
   * The knob follows the finger on the UI thread, but the *label* is React
   * state, and pushing one per gesture frame would be a render at 120Hz to
   * change a string that can only change 1/s. This is what keeps a drag from
   * being the most expensive thing the app does.
   */
  const pushedSec = useSharedValue(-1);

  const publishScrub = (fractionValue: number) => {
    'worklet';
    const seconds = fractionValue * total.value;
    const whole = Math.floor(seconds);
    if (whole === pushedSec.value) return;
    pushedSec.value = whole;
    runOnJS(setScrubSec)(seconds);
  };

  useEffect(() => {
    if (dragging.value) return;

    const target =
      durationSec && durationSec > 0
        ? Math.min(1, Math.max(0, positionSec / durationSec))
        : 0;

    fraction.value = withTiming(target, {
      duration: POSITION_INTERVAL_MS,
      easing: Easing.linear,
    });
  }, [positionSec, durationSec, dragging, fraction]);

  const fill = useAnimatedStyle(() => ({ width: `${fraction.value * 100}%` }));

  const knob = useAnimatedStyle(() => ({
    left: `${fraction.value * 100}%`,
    transform: [{ translateX: -KNOB_SIZE / 2 }, { scale: 0.6 + knobScale.value * 0.4 }],
    opacity: 0.4 + knobScale.value * 0.6,
  }));

  const seekable = (durationSec ?? 0) > 0;

  /**
   * The knob's grow-on-touch, gated for reduced motion: a quick tween instead
   * of a spring, so the answer ("you have the handle") arrives without the
   * bounce. Only the knob — the 500ms position tween above is a clock, and a
   * clock is motion-safe by nature.
   */
  const growKnob = (to: 0 | 1) => {
    'worklet';
    if (!reduced) {
      knobScale.value = withSpring(to, { ...spring.snappy, ...springRest });
      return;
    }
    knobScale.value = withTiming(to, {
      duration: duration.fast,
      easing: Easing.bezier(...easing.enter),
    });
  };

  const pan = Gesture.Pan()
    .enabled(seekable)
    // Claims the gesture immediately: a scrubber inside a scroll view that
    // waits to see whether you meant to scroll misses the first few pixels of
    // every drag.
    .activeOffsetX([-4, 4])
    .onBegin((event) => {
      if (width <= 0) return;
      dragging.value = true;
      pushedSec.value = -1;
      growKnob(1);
      fraction.value = Math.min(1, Math.max(0, event.x / width));
      publishScrub(fraction.value);
    })
    .onUpdate((event) => {
      if (width <= 0) return;
      fraction.value = Math.min(1, Math.max(0, event.x / width));
      publishScrub(fraction.value);
    })
    .onFinalize(() => {
      growKnob(0);
      if (total.value > 0) runOnJS(onSeek)(fraction.value * total.value);
      dragging.value = false;
      // Cleared last: until the seek lands, `positionSec` still holds the old
      // playhead, and dropping the scrub value first would flash the label
      // back to where playback *was* for one frame.
      runOnJS(setScrubSec)(null);
    });

  const elapsed = scrubSec ?? positionSec;
  const remaining = durationSec === null ? null : Math.max(0, durationSec - elapsed);

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={pan}>
        <View
          style={styles.hitArea}
          onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Playback position"
          accessibilityValue={{
            min: 0,
            max: Math.round(durationSec ?? 0),
            now: Math.round(elapsed),
            text: formatTimestamp(elapsed),
          }}
          accessibilityActions={[
            { name: 'increment', label: 'Forward 30 seconds' },
            { name: 'decrement', label: 'Back 15 seconds' },
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') onSeek(elapsed + 30);
            if (event.nativeEvent.actionName === 'decrement') onSeek(elapsed - 15);
          }}
        >
          <View style={[styles.track, { backgroundColor: theme.border }]}>
            <Animated.View style={[styles.fill, { backgroundColor: theme.accent }, fill]} />
          </View>

          {seekable ? (
            <Animated.View style={[styles.knob, { backgroundColor: theme.accent }, knob]} />
          ) : null}
        </View>
      </GestureDetector>

      <View style={styles.times}>
        <Text style={[type('caption'), { color: theme.textTertiary }]}>
          {formatTimestamp(elapsed)}
        </Text>
        <Text style={[type('caption'), { color: theme.textTertiary }]}>
          {/*
            Counting down rather than up: what a listener wants from the right
            side of a scrubber is how much is left, not the episode's length,
            which the row they tapped already told them.
          */}
          {remaining === null ? '—' : `−${formatTimestamp(remaining)}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', marginTop: space[6] },
  // Tall enough to be a real 44px touch target while the track itself is 4px.
  hitArea: { height: 44, justifyContent: 'center' },
  track: { height: TRACK_HEIGHT, borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: TRACK_HEIGHT },
  knob: {
    position: 'absolute',
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: radius.full,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space[1],
  },
});
