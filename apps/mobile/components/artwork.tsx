import { radiusForArtwork } from '@cue/design';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';

/**
 * Podcast artwork.
 *
 * The radius scales with the rendered size rather than being fixed: a 44px
 * thumbnail at 16px radius is a blob, and a 320px cover at 6px is a sticker.
 * That rule lives in `@cue/design` so a thumbnail and a full cover can never
 * disagree about how round artwork is.
 */
export function Artwork({
  url,
  size,
  label,
  radius,
}: {
  url: string | null;
  size: number;
  /** What the image is of. Omitted for decorative art beside its own title. */
  label?: string;
  /**
   * Override the size-derived radius.
   *
   * For artwork that is not the outer edge of anything — a quadrant of a
   * playlist's cover stack, where the rounding belongs to the tile around it
   * and rounding each quarter as well would cut four bites out of the middle.
   */
  radius?: number;
}) {
  const theme = useTheme();
  const borderRadius = radius ?? radiusForArtwork(size);

  const frame = {
    width: size,
    height: size,
    borderRadius,
    backgroundColor: theme.skeleton,
  };

  if (!url) {
    // A tinted blank rather than a broken-image glyph or an invented
    // placeholder illustration: plenty of real feeds have no artwork, and it
    // should read as "this show has no cover", not as a failure.
    return <View style={[frame, styles.blank, { borderColor: theme.border }]} />;
  }

  return (
    <Image
      source={url}
      style={frame}
      contentFit="cover"
      // expo-image caches to disk, so artwork survives a restart and scrolling
      // back up costs nothing.
      cachePolicy="memory-disk"
      transition={200}
      accessibilityIgnoresInvertColors
      {...(label ? { accessible: true, accessibilityLabel: label } : {})}
    />
  );
}

const styles = StyleSheet.create({
  blank: { borderWidth: StyleSheet.hairlineWidth },
});
