import { pressScale, spring, springRest } from '@cue/motion';
import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { radius, space, type, useTheme } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A button.
 *
 * The press-scale is the entire animation, and it is the one that matters most
 * — it is the app's answer to "did that register?" on a surface with no cursor
 * and no hover state to answer it first.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);

  // Reduced motion makes the squash shallower rather than removing it — the
  // depth comes from the shared policy so web and Android agree on how far a
  // press goes, and neither has to remember the number.
  const depth = pressScale(0.96, reduced);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - depth) }],
    opacity: 1 - pressed.value * 0.08,
  }));

  const isPrimary = variant === 'primary';

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        pressed.value = withSpring(1, { ...spring.responsive, ...springRest });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, { ...spring.responsive, ...springRest });
      }}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={[
        styles.base,
        {
          backgroundColor: isPrimary ? theme.accent : 'transparent',
          borderColor: isPrimary ? 'transparent' : theme.borderStrong,
          borderWidth: isPrimary ? 0 : StyleSheet.hairlineWidth,
          opacity: disabled ? 0.5 : 1,
        },
        animated,
        style,
      ]}
    >
      <Text
        style={[
          type('bodyStrong'),
          { color: isPrimary ? theme.textOnAccent : theme.textPrimary },
        ]}
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: space[5],
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
