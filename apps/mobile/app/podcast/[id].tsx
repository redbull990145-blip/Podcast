import { queryKeys, staleTime } from '@cue/api-client';
import { useTranslator } from '@/lib/i18n';
import { deriveTint, icon } from '@cue/design';
import type { Episode } from '@cue/types';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '@/components/artwork';
import { EpisodeRow } from '@/components/episode-row';
import { Icon } from '@/components/icon';
import { ScreenMessage } from '@/components/screen-message';
import { SubscribeButton } from '@/components/subscribe-button';
import { api } from '@/lib/api';
import { usePlayerState } from '@/lib/player/store';
import { TAB_BAR_HEIGHT, space, type, useTheme } from '@/theme';

/**
 * A show and its episodes.
 *
 * The episode list is paged rather than fetched whole: real back catalogues
 * run to thousands of episodes, and one of the seeded feeds has three thousand
 * precisely so this screen is built against that rather than against a
 * comfortable fifty.
 */
export default function PodcastScreen() {
  const t = useTranslator();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const playing = usePlayerState().current !== null;

  const { data: podcastData, error } = useQuery({
    queryKey: queryKeys.podcast.detail(id),
    queryFn: () => api.getPodcast(id),
    staleTime: staleTime.podcast,
  });

  const episodes = useInfiniteQuery({
    queryKey: queryKeys.podcast.episodes(id),
    queryFn: ({ pageParam }) => api.getEpisodes(id, { cursor: pageParam, limit: 50 }),
    initialPageParam: null as string | null,
    // Presence of a cursor — not a count — is what says whether to keep going.
    getNextPageParam: (last) => last.nextCursor,
    staleTime: staleTime.episodes,
  });

  const podcast = podcastData?.podcast;

  const tint = useMemo(
    () => (podcast?.accentColor ? deriveTint(podcast.accentColor, 'dark') : null),
    [podcast?.accentColor],
  );

  const items = useMemo(
    () => episodes.data?.pages.flatMap((page) => page.items) ?? [],
    [episodes.data],
  );

  const renderItem = useCallback(
    ({ item }: { item: Episode }) => (
      <EpisodeRow
        episode={item}
        podcastTitle={podcast?.title ?? ''}
        fallbackArtwork={podcast?.artworkUrl ?? null}
        accentColor={podcast?.accentColor ?? null}
      />
    ),
    [podcast?.title, podcast?.artworkUrl, podcast?.accentColor],
  );

  const back = (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={space[3]}
      style={styles.back}
    >
      {/* The chevron rotated a quarter turn — one path, two directions. */}
      <View style={styles.backIcon}>
        <Icon path={icon.chevronDown} size={26} color={theme.textSecondary} />
      </View>
    </Pressable>
  );

  if (error) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        {back}
        <ScreenMessage
          title="Couldn't load this show"
          body="It may have been removed, or the connection dropped."
        />
      </View>
    );
  }

  if (!podcast) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        {back}
        <ScreenMessage title="Loading…" />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      {back}

      <FlashList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            {/*
              An ambient wash of the show's own colour, felt rather than seen —
              it sits under 2:1 against the background by construction.
            */}
            {tint ? (
              <View style={[styles.wash, { backgroundColor: tint.wash }]} pointerEvents="none" />
            ) : null}

            <Artwork url={podcast.artworkUrl} size={160} label={podcast.title} />

            <Text style={[type('title2'), { color: theme.textPrimary, marginTop: space[5] }]}>
              {podcast.title}
            </Text>

            {podcast.author ? (
              <Text style={[type('callout'), { color: theme.textSecondary, marginTop: space[1] }]}>
                {podcast.author}
              </Text>
            ) : null}

            {podcast.episodeCount !== null ? (
              <Text style={[type('caption'), { color: theme.textTertiary, marginTop: space[2] }]}>
                {t.t('podcast.episodeCount', { count: podcast.episodeCount })}
              </Text>
            ) : null}

            <View style={styles.action}>
              <SubscribeButton podcastId={podcast.id} />
            </View>

            {podcast.description ? (
              <Text
                numberOfLines={6}
                style={[
                  type('body'),
                  { color: theme.textSecondary, marginTop: space[5] },
                ]}
              >
                {podcast.description}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          episodes.isPending ? (
            <ScreenMessage title="Loading episodes…" />
          ) : (
            <ScreenMessage
              title="No episodes yet"
              body="The publisher hasn't put anything in this feed."
            />
          )
        }
        ListFooterComponent={
          episodes.isFetchingNextPage ? (
            <Text
              style={[
                type('caption'),
                { color: theme.textTertiary, textAlign: 'center', padding: space[5] },
              ]}
            >
              Loading more…
            </Text>
          ) : null
        }
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (episodes.hasNextPage && !episodes.isFetchingNextPage) {
            void episodes.fetchNextPage();
          }
        }}
        contentContainerStyle={{
          paddingBottom: space[6] + (playing ? TAB_BAR_HEIGHT : 0),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { padding: space[3], alignSelf: 'flex-start' },
  backIcon: { transform: [{ rotate: '90deg' }] },
  header: {
    paddingHorizontal: space[5],
    paddingBottom: space[6],
    alignItems: 'center',
  },
  wash: {
    position: 'absolute',
    top: -space[16],
    left: -space[10],
    right: -space[10],
    height: 260,
  },
  action: { marginTop: space[5], alignSelf: 'stretch' },
});
