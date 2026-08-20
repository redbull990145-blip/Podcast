import { queryKeys, staleTime } from '@cue/api-client';
import { deriveCover } from '@cue/design';
import type { Category, PodcastSearchResult } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslator } from '@/lib/i18n';
import { api } from '@/lib/api';
import { radius, space, type, useTheme } from '@/theme';

/** How many categories get a tile before the rest become a list. */
const FEATURED = 4;
/** How many trending shows are worth ranking on a phone. */
const RANKED = 6;

/**
 * What a search screen shows before anyone has searched.
 *
 * The screen used to say "Find a show — search the directory by name, topic,
 * or the person who makes it", which is an instruction, and an instruction is
 * a dead end for anyone who does not already know what they want. That is most
 * people opening a directory: they are here *because* they have not decided.
 *
 * So the resting state is the catalogue's own shape — its categories, with
 * real counts — and what the directory says is rising. Both are things to
 * press rather than things to read.
 */
export function Browse({ onOpenResult }: { onOpenResult: (feedUrl: string) => void }) {
  const t = useTranslator();
  const theme = useTheme();

  const categories = useQuery({
    queryKey: queryKeys.discover.categories(),
    queryFn: () => api.listCategories(),
    staleTime: staleTime.categories,
  });

  const trending = useQuery({
    queryKey: queryKeys.discover.trending(),
    queryFn: () => api.trendingPodcasts({ limit: 12 }),
    staleTime: staleTime.trending,
  });

  const items = categories.data?.items ?? [];
  const featured = items.slice(0, FEATURED);
  const rest = items.slice(FEATURED);
  const rising = trending.data?.results ?? [];

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      {items.length > 0 ? (
        <View style={styles.section}>
          <Text style={[type('overline'), { color: theme.textTertiary }]}>
            {t.t('search.browse').toUpperCase()}
          </Text>

          {/* Two across, 16:9. Four square tiles would be most of a phone
              screen for a list of names, and these are not covers — giving
              them a cover's shape is how someone ends up pressing a category
              expecting a show. */}
          <View style={styles.tiles}>
            {featured.map((category) => (
              <Tile key={category.slug} category={category} />
            ))}
          </View>

          {rest.map((category) => (
            <CategoryRow key={category.slug} category={category} />
          ))}
        </View>
      ) : null}

      {rising.length > 0 ? (
        <View style={styles.section}>
          <Text style={[type('overline'), { color: theme.textTertiary }]}>
            {t.t('search.trending').toUpperCase()}
          </Text>

          {rising.slice(0, RANKED).map((result, index) => (
            <RankedRow
              key={result.feedUrl}
              result={result}
              rank={index + 1}
              onPress={() => onOpenResult(result.feedUrl)}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * One category, wearing a colour borrowed from a show inside it.
 *
 * `deriveCover` guarantees both ends of the gradient are dark enough for the
 * white label, whatever hue the catalogue happens to supply — which is the
 * only reason a tile can carry text at all when nobody chose its colour.
 *
 * React Native has no `linear-gradient`, and this is not worth a dependency:
 * two stacked views, the lighter one under a half-width darker one, reads as a
 * diagonal wash at this size and costs nothing.
 */
function Tile({ category }: { category: Category }) {
  const router = useRouter();
  const theme = useTheme();
  const cover = category.accentColor ? deriveCover(category.accentColor) : null;

  const label = cover ? '#FFFFFF' : theme.textPrimary;

  return (
    <Pressable
      onPress={() => router.push(`/search?category=${category.slug}`)}
      accessibilityRole="button"
      accessibilityLabel={`${category.name}, ${category.count}`}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: cover?.from ?? theme.surfaceRaised,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {cover ? (
        <View style={[styles.tileShade, { backgroundColor: cover.to }]} />
      ) : null}

      <Text numberOfLines={2} style={[type('title3'), { color: label }]}>
        {category.name}
      </Text>
      <Text style={[type('caption'), { color: label, opacity: cover ? 0.85 : 1 }]}>
        {category.count}
      </Text>
    </Pressable>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const router = useRouter();
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => router.push(`/search?category=${category.slug}`)}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: theme.border,
          backgroundColor: pressed ? theme.surfaceHover : 'transparent',
        },
      ]}
    >
      <Text style={[type('bodyStrong'), { color: theme.textPrimary, flex: 1 }]}>
        {category.name}
      </Text>
      <Text style={[type('caption'), { color: theme.textTertiary }]}>{category.count}</Text>
    </Pressable>
  );
}

/**
 * A trending show, with its position.
 *
 * The number is the content. A trending list without positions is just a list,
 * and the whole reason anyone reads one is to see what is above what.
 */
function RankedRow({
  result,
  rank,
  onPress,
}: {
  result: PodcastSearchResult;
  rank: number;
  onPress: () => void;
}) {
  const theme = useTheme();

  const meta = [result.categories[0], result.author].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={result.title}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: theme.border,
          backgroundColor: pressed ? theme.surfaceHover : 'transparent',
        },
      ]}
    >
      {/* Padded to two digits so the titles line up in a column rather than
          stepping right when the list reaches ten. */}
      <Text style={[type('timecode'), styles.rank, { color: theme.accentText }]}>
        {String(rank).padStart(2, '0')}
      </Text>

      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[type('bodyStrong'), { color: theme.textPrimary }]}>
          {result.title}
        </Text>
        {meta ? (
          <Text
            numberOfLines={1}
            style={[type('caption'), { color: theme.textTertiary, marginTop: 2 }]}
          >
            {meta}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: space[10] },
  section: { paddingHorizontal: space[5], paddingBottom: space[6], gap: space[3] },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  tile: {
    // Two across the gutter, minus the gap between them. Written as a
    // percentage so it survives a rotation without a measurement.
    width: '48.5%',
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    padding: space[3],
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  /* The darker half of the "gradient", pinned to the bottom-right corner and
     twice the tile's size so its corner cuts across on the diagonal. */
  tileShade: {
    position: 'absolute',
    top: '35%',
    left: '35%',
    right: -40,
    bottom: -40,
    transform: [{ rotate: '-20deg' }],
    opacity: 0.9,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: { width: 22 },
  rowText: { flex: 1 },
});
