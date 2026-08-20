export { colorSchemes, dark, ember, light, paper } from './tokens/color.ts';
export type { ColorScheme, ThemeName } from './tokens/color.ts';

export {
  contrastRatio,
  deriveCover,
  deriveTint,
  hexToRgb,
  oklabToRgb,
  relativeLuminance,
  rgbToHex,
  rgbToOklab,
} from './tokens/tint.ts';
export type { Rgb, TintSet } from './tokens/tint.ts';

export { icon } from './tokens/icons.ts';
export type { IconPath, IconToken } from './tokens/icons.ts';

export { fontFamily, fontWeight, text } from './tokens/typography.ts';
export type { TextStyle, TextToken } from './tokens/typography.ts';

export {
  artworkRadius,
  elevation,
  hitSlop,
  measure,
  nativeElevation,
  radius,
  space,
} from './tokens/layout.ts';

import { artworkRadius } from './tokens/layout.ts';

/**
 * Pick the artwork corner radius for a rendered size. Centralised so a
 * thumbnail and a cover can never disagree about how round artwork is.
 */
export function radiusForArtwork(sizePx: number): number {
  if (sizePx <= 56) return artworkRadius.sm;
  if (sizePx <= 160) return artworkRadius.md;
  if (sizePx <= 280) return artworkRadius.lg;
  return artworkRadius.xl;
}
