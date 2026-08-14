import { queryKeys, staleTime } from '@cue/api-client';
import { useTranslator } from '@/lib/i18n';
import type { PodcastSearchResult } from '@cue/types';
import { FlashList } from '@shopify/flash-list';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useDeferredValue, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '@/components/artwork';
import { ScreenMessage } from '@/components/screen-message';
import { api, ApiClientError } from '@/lib/api';
import { usePlayerState } from '@/lib/player/store';
import { TAB_BAR_HEIGHT, radius, space, type, useTheme } from '@/theme';

/**
 * Search.
 *
 * The front door, not a secondary tab: someone arriving with no subscriptions
 * has to be able to find a show before anything else in the app means
 * anything.
 */
export default function SearchScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const playing = usePlayerState().current !== null;

  const [query, setQuery] = useState('');
  // Keeps typing responsive: the field updates every keystroke, the request
  // trails behind it.
  const deferred = useDeferredValue(query.trim());

  const { data, isFetching, error } = useQuery({
    queryKey: queryKeys.discover.search(deferred),
    queryFn: () => api.searchPodcasts(deferred),
    enabled: deferred.length > 1,
    staleTime: staleTime.search,
    // Results stay on screen while the next query runs, so refining a search
    // does not flash an empty list between terms.
    placeholderData: keepPreviousData,
  });

  const renderItem = useCallback(
    ({ item }: { item: PodcastSearchResult }) => <ResultRow result={item} />,
    [],
  );

  const notConfigured =
    error instanceof ApiClientError && error.code === 'upstream_unavailable';

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[type('title1'), { color: theme.textPrimary }]}>Search</Text>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Shows, topics, people"
          placeholderTextColor={theme.textTertiary}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Search for podcasts"
          style={[
            styles.input,
            type('body'),
            {
              backgroundColor: theme.surfaceRaised,
              borderColor: theme.border,
              color: theme.textPrimary,
            },
          ]}
        />
      </View>

      {deferred.length <= 1 ? (
        <ScreenMessage
          title="Find a show"
          body="Search the directory by name, topic, or the person who makes it."
        />
      ) : null}

      {deferred.length > 1 && error ? (
        <ScreenMessage
          title={notConfigured ? 'Search is not configured' : 'Search failed'}
          body={
            notConfigured
              ? 'The server needs PODCASTINDEX_KEY and PODCASTINDEX_SECRET. Everything else works without them.'
              : 'Something went wrong reaching the directory. Try again in a moment.'
          }
        />
      ) : null}

      {deferred.length > 1 && !error && isFetching && !data ? (
        <ScreenMessage title="Searching…" />
      ) : null}

      {deferred.length > 1 && !error && data && data.results.length === 0 ? (
        <ScreenMessage title="No shows matched" body={`Nothing came back for “${deferred}”.`} />
      ) : null}

      {data && data.results.length > 0 ? (
        <FlashList
          data={data.results}
          renderItem={renderItem}
          keyExtractor={(item) => item.feedUrl}
          keyboardDismissMode="on-drag"
          contentContainerStyle={{
            paddingBottom: space[6] + (playing ? TAB_BAR_HEIGHT : 0),
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * A search hit.
 *
 * These come from the upstream directory and are not in our database, so they
 * have no id and nothing to link to yet. Tapping one ingests the feed, which
 * is what gives the show an id — and only then can we navigate to it.
 */
function ResultRow({ result }: { result: PodcastSearchResult }) {
  const t = useTranslator();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const add = useMutation({
    mutationFn: () => api.addPodcast(result.feedUrl),
    onSuccess: ({ podcast }) => {
      // Seed the detail screen's cache so it renders instantly rather than
      // re-fetching what we were just handed.
      queryClient.setQueryData(queryKeys.podcast.detail(podcast.id), { podcast });
      router.push(`/podcast/${podcast.id}`);
    },
  });

  const meta = [
    result.author,
    result.episodeCount === null ? null : t.t('podcast.episodeCount', { count: result.episodeCount }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={() => add.mutate()}
      disabled={add.isPending}
      accessibilityRole="button"
      accessibilityLabel={result.title}
      accessibilityState={{ busy: add.isPending }}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: theme.border,
          backgroundColor: pressed ? theme.surfaceHover : 'transparent',
          opacity: add.isPending ? 0.6 : 1,
        },
      ]}
    >
      <Artwork url={result.artworkUrl} size={56} />

      <View style={styles.rowText}>
        <Text numberOfLines={2} style={[type('bodyStrong'), { color: theme.textPrimary }]}>
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
        {add.isError ? (
          <Text style={[type('caption'), { color: theme.danger, marginTop: 2 }]}>
            Couldn’t open this show
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: space[5],
    paddingTop: space[6],
    paddingBottom: space[4],
    gap: space[4],
  },
  input: {
    minHeight: 48,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    gap: space[4],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, justifyContent: 'center' },
});
