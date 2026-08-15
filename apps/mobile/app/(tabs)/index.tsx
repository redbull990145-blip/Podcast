import { queryKeys, staleTime } from '@cue/api-client';
import { useTranslator } from '@/lib/i18n';
import type { Podcast } from '@cue/types';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '@/components/artwork';
import { ContinueListening } from '@/components/continue-listening';
import { OfflineNotice } from '@/components/offline-notice';
import { ScreenMessage } from '@/components/screen-message';
import { api } from '@/lib/api';
import { useOnline } from '@/lib/connectivity';
import { usePlayerState } from '@/lib/player/store';
import { TAB_BAR_HEIGHT, space, type, useTheme } from '@/theme';

/**
 * Listen — the catalogue.
 *
 * FlashList rather than FlatList: it recycles row views instead of mounting
 * one per item, which is the difference between a smooth scroll and a
 * stuttering one once the catalogue has a few hundred shows.
 */
export default function ListenScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const playing = usePlayerState().current !== null;
  const online = useOnline();

  const { data, isPending, error, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.podcast.list(),
    queryFn: () => api.getPodcasts({ limit: 30 }),
    staleTime: staleTime.podcast,
  });

  const renderItem = useCallback(
    ({ item }: { item: Podcast }) => <PodcastRow podcast={item} />,
    [],
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[type('title1'), { color: theme.textPrimary }]}>Listen</Text>
      </View>

      {error ? (
        online ? (
          <ScreenMessage
            title="Couldn't reach the server"
            // The LAN-address mistake is the overwhelmingly likely cause on a
            // physical device, so the empty state says so rather than shrugging.
            body="Set EXPO_PUBLIC_API_URL to your computer's LAN address — a phone resolves localhost to itself."
          />
        ) : (
          // With no connection the server is not misconfigured, it is simply
          // unreachable — and blaming an env var for a tunnel is how a working
          // app sends someone to edit their setup.
          <OfflineNotice />
        )
      ) : null}

      {!error && isPending ? <ScreenMessage title="Loading…" /> : null}

      {!error && !isPending && (data?.items.length ?? 0) === 0 ? (
        <ScreenMessage
          title="Nothing here yet"
          body="Seed the local database with: npm run seed -w @cue/api"
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <FlashList
          data={data.items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          // Inside the list rather than above it, so what is in progress
          // scrolls away with the catalogue instead of pinning a band to the
          // top of a phone screen that has little enough height already.
          ListHeaderComponent={ListenHeader}
          contentContainerStyle={{
            // Clears the mini player when there is one, so the last row is
            // never parked underneath it.
            paddingBottom: space[6] + (playing ? TAB_BAR_HEIGHT : 0),
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              tintColor={theme.textSecondary}
            />
          }
        />
      ) : null}
    </View>
  );
}

/**
 * What sits above the catalogue.
 *
 * Declared outside the screen component so its identity is stable across
 * renders — a header defined inline is a new component type every time, which
 * makes FlashList tear down and rebuild it on each list update.
 */
function ListenHeader() {
  const theme = useTheme();

  return (
    <View>
      <ContinueListening />
      <Text style={[type('overline'), styles.catalogueHeading, { color: theme.textTertiary }]}>
        IN YOUR CATALOGUE
      </Text>
    </View>
  );
}

function PodcastRow({ podcast }: { podcast: Podcast }) {
  const t = useTranslator();
  const theme = useTheme();

  const meta = [
    podcast.author,
    podcast.episodeCount === null ? null : t.t('podcast.episodeCount', { count: podcast.episodeCount }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link href={`/podcast/${podcast.id}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={podcast.title}
        style={({ pressed }) => [
          styles.row,
          {
            borderBottomColor: theme.border,
            backgroundColor: pressed ? theme.surfaceHover : 'transparent',
          },
        ]}
      >
        <Artwork url={podcast.artworkUrl} size={56} />

        <View style={styles.rowText}>
          <Text numberOfLines={2} style={[type('bodyStrong'), { color: theme.textPrimary }]}>
            {podcast.title}
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
    </Link>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: space[5],
    paddingTop: space[6],
    paddingBottom: space[4],
  },
  catalogueHeading: { paddingHorizontal: space[5], paddingBottom: space[2] },
  row: {
    flexDirection: 'row',
    gap: space[4],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, justifyContent: 'center' },
});
