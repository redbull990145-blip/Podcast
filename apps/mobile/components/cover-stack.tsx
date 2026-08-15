import { radiusForArtwork } from '@cue/design';
import { StyleSheet, View } from 'react-native';
import { Artwork } from '@/components/artwork';
import { useTheme } from '@/theme';

/**
 * A playlist's cover: the first few episodes' artwork, tiled.
 *
 * A collection has to look like one. A single cover makes a playlist
 * indistinguishable from an episode, and a folder glyph makes it
 * indistinguishable from every other playlist — the artwork *is* the
 * recognition, which is why the API ships four URLs rather than making the app
 * fetch each playlist's contents to draw a row.
 *
 * Degrades honestly: four tile 2×2, fewer fill the square, none draws an empty
 * frame rather than a placeholder pretending to be a cover.
 */
export function CoverStack({
  artworkUrls,
  title,
  size,
}: {
  artworkUrls: string[];
  title: string;
  size: number;
}) {
  const theme = useTheme();
  const covers = artworkUrls.slice(0, 4);

  if (covers.length === 0) {
    return (
      <View
        style={[
          styles.empty,
          {
            width: size,
            height: size,
            borderRadius: radiusForArtwork(size),
            borderColor: theme.border,
            backgroundColor: theme.surfaceRaised,
          },
        ]}
      />
    );
  }

  if (covers.length < 4) {
    return <Artwork url={covers[0] ?? null} size={size} label={title} />;
  }

  // A hairline of the container's colour shows between quadrants, which is
  // what keeps four pale covers from reading as one smeared image.
  const quarter = (size - StyleSheet.hairlineWidth) / 2;

  return (
    <View
      style={[
        styles.grid,
        {
          width: size,
          height: size,
          borderRadius: radiusForArtwork(size),
          backgroundColor: theme.border,
        },
      ]}
    >
      {covers.map((url, index) => (
        // Index in the key as well as the URL: these are four fixed positions,
        // and two episodes of one show legitimately share a cover.
        <Artwork key={`${url}-${index}`} url={url} size={quarter} radius={0} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    overflow: 'hidden',
    gap: StyleSheet.hairlineWidth,
  },
});
