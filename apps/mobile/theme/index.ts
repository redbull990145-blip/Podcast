/**
 * The native theme.
 *
 * Reads the same token package the web app compiles into CSS variables, so a
 * colour or a type size is defined once and cannot drift between platforms.
 * What differs is only the shape: the web needs strings in a stylesheet,
 * React Native needs numbers in an object.
 */

import {
  colorSchemes,
  fontWeight,
  nativeElevation,
  radius,
  space,
  text,
  type ColorScheme,
  type TextToken,
} from '@cue/design';
import { useColorScheme, type TextStyle } from 'react-native';

export { radius, space, fontWeight, nativeElevation };

/**
 * Height of the tab bar, excluding the bottom safe-area inset.
 *
 * Set explicitly rather than left to the platform default because the mini
 * player has to sit exactly on top of it. Two components agreeing on a number
 * they each guessed is how you get a 2px seam that only appears on some
 * devices.
 */
export const TAB_BAR_HEIGHT = 56;

/**
 * Height of the mini player, including its progress hairline.
 *
 * Stated for the same reason as the tab bar: something has to stack on top of
 * it. The bar itself is sized by its contents — 44px of artwork inside `space[2]`
 * of padding, plus a 2px track — and this is that sum, written down so the
 * offline strip can sit above it without either component guessing.
 */
export const MINI_PLAYER_HEIGHT = 62;

/**
 * Dark-first, matching the web app: artwork sits better on a dark ground, and
 * that is the surface most listening happens on.
 */
export function useTheme(): ColorScheme {
  const scheme = useColorScheme();
  return scheme === 'light' ? colorSchemes.light : colorSchemes.dark;
}

/**
 * A type token as a React Native style.
 *
 * `letterSpacing` is the one value that needs converting: the tokens store it
 * in em (what CSS wants) and React Native takes absolute points, so it is
 * multiplied by the font size. Skipping that conversion is why native
 * typography so often looks subtly looser than its web counterpart.
 */
export function type(token: TextToken): TextStyle {
  const style = text[token];

  return {
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing * style.fontSize,
    fontWeight: style.fontWeight as TextStyle['fontWeight'],
  };
}
