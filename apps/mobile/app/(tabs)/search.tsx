import { queryKeys, staleTime } from '@cue/api-client';
import { useTranslator } from '@/lib/i18n';
import type { Podcast, PodcastSearchResult } from '@cue/types';
import { FlashList } from '@shopify/flash-list';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '@/components/artwork';
import { Browse } from '@/components/browse';
import { OfflineNotice } from '@/components/offline-notice';
import { ScreenMessage } from '@/components/screen-message';
import { api, ApiClientError } from '@/lib/api';
import { useOnline } from '@/lib/connectivity';
import { useDebounced } from '@/lib/use-debounced';
import { usePlayerState } from '@/lib/player/store';
import { TAB_BAR_HEIGHT, radius, space, type, useTheme } from '@/theme';

/**
 * How long typing has to stop before a request goes out.
 *
 * A little longer than the web's, because phone typing is slower and less
 * even, and because every request here is a cellular round trip rather than a
 * local one.
 */
const DEBOUNCE_MS = 300;

/** Characters a query needs before it is worth sending anywhere. */
const MIN_QUERY = 3;

/**
 * Search.
 *
 * The front door, not a secondary tab: someone arriving with no subscriptions
 * has to be able to find a show before anything else in the app means
 * anything.
 */
export default function SearchScreen() {
  const t = useTranslator();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const playing = usePlayerState().current !== null;

  /* Set by a tile on the browse screen. Typing anything takes precedence —
     someone who starts a search has stopped browsing, and leaving a category
     header above unrelated results would be the app arguing with them. */
  const { category } = useLocalSearchParams<{ category?: string }>();

  const queryClient = useQueryClient();

  const online = useOnline();

  const [query, setQuery] = useState('');
  /* The field updates on every keystroke; the request waits for the typing to
     stop. This was `useDeferredValue`, which keeps the field responsive but
     still lets a request out per letter — see `useDebounced`. */
  const debounced = useDebounced(query.trim(), DEBOUNCE_MS);
  const searching = debounced.length >= MIN_QUERY;

  const { data, isFetching, error } = useQuery({
    queryKey: queryKeys.discover.search(debounced),
    // The signal is TanStack Query's: an answer nobody is waiting for any more
    // is cancelled in flight rather than raced against the current one.
    queryFn: ({ signal }) => api.searchPodcasts(debounced, { signal }),
    enabled: searching,
    staleTime: staleTime.search,
    // Results stay on screen while the next query runs, so refining a search
    // does not flash an empty list between terms.
    placeholderData: keepPreviousData,
  });

  const renderItem = useCallback(
    ({ item }: { item: PodcastSearchResult }) => <ResultRow result={item} />,
    [],
  );

  /**
   * Read a feed and go to the show it turns into.
   *
   * Trending rows have no id — nothing in the directory does until its feed
   * has been read — so opening one is a mutation rather than a navigation. It
   * is still not a commitment: nothing lands in anybody's library until Follow
   * is pressed on the show's own screen.
   */
  const openFeed = useMutation({
    mutationFn: (feedUrl: string) => api.addPodcast(feedUrl),
    onSuccess: ({ podcast }) => {
      queryClient.setQueryData(queryKeys.podcast.detail(podcast.id), { podcast });
      router.push(`/podcast/${podcast.id}`);
    },
  });

  const notConfigured =
    error instanceof ApiClientError && error.code === 'upstream_unavailable';

  /* Nothing typed at all — the screen's resting state, which is Browse rather
     than a prompt. Someone part-way through a word gets the "keep typing" note
     below instead, because a screen that reverts to browse tiles the moment a
     letter lands reads as the search having been thrown away. */
  const idle = debounced.length === 0;
  const tooShort = !idle && !searching;
  const browsingCategory = idle && typeof category === 'string' && category.length > 0;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[type('display'), { color: theme.textPrimary }]}>Search</Text>

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

      {idle && !browsingCategory ? (
        <Browse
          onOpenResult={(feedUrl) => {
            openFeed.mutate(feedUrl);
          }}
        />
      ) : null}

      {browsingCategory ? <CategoryList slug={category} /> : null}

      {tooShort ? (
        <ScreenMessage title={t.t('search.tooShort')} body={t.t('search.tooShortBody')} />
      ) : null}

      {/* Offline first. Every request fails identically in a tunnel and
          against a broken server, and only one of those two explanations is
          ever true on a phone — blaming an env var for a lost signal is how a
          working app sends someone to edit their setup. */}
      {searching && error && !online ? <OfflineNotice /> : null}

      {searching && error && online ? (
        <ScreenMessage
          title={notConfigured ? 'Search is not configured' : 'Search failed'}
          body={
            notConfigured
              ? 'The server needs PODCASTINDEX_KEY and PODCASTINDEX_SECRET. Everything else works without them.'
              : 'Something went wrong reaching the directory. Try again in a moment.'
          }
        />
      ) : null}

      {searching && !error && isFetching && !data ? (
        <ScreenMessage title={t.t('search.searching')} />
      ) : null}

      {searching && !error && data && data.results.length === 0 ? (
        <ScreenMessage
          title={t.t('search.noResults')}
          body={t.t('search.noResultsBody')}
        />
      ) : null}

      {searching && data && data.results.length > 0 ? (
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
 * One category's shows, from Cue's own catalogue.
 *
 * What a browse tile opens onto. Deliberately the same row the Listen screen
 * uses rather than a second results layout — it is the same kind of answer,
 * narrowed, and a category screen that looked like a different product would
 * be the tell that it was bolted on.
 */
function CategoryList({ slug }: { slug: string }) {
  const t = useTranslator();
  const theme = useTheme();
  const playing = usePlayerState().current !== null;

  const list = useQuery({
    queryKey: queryKeys.discover.inCategory(slug),
    queryFn: () => api.getPodcasts({ category: slug, limit: 40 }),
    staleTime: staleTime.podcast,
  });

  const categories = useQuery({
    queryKey: queryKeys.discover.categories(),
    queryFn: () => api.listCategories(),
    staleTime: staleTime.categories,
  });

  const name = categories.data?.items.find((item) => item.slug === slug)?.name ?? slug;
  const items = list.data?.items ?? [];

  if (list.isPending) return <ScreenMessage title="Loading…" />;

  if (items.length === 0) {
    return (
      <ScreenMessage
        title={name}
        body="Nothing in the catalogue carries this category yet."
      />
    );
  }

  return (
    <FlashList
      data={items}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <View style={styles.categoryHeader}>
          <Text style={[type('title2'), { color: theme.textPrimary }]}>{name}</Text>
          <Text style={[type('callout'), { color: theme.textTertiary, marginTop: 2 }]}>
            {t.t('search.inCatalogue', { count: items.length })}
          </Text>
        </View>
      }
      renderItem={({ item }: { item: Podcast }) => <CatalogueRow podcast={item} />}
      contentContainerStyle={{
        paddingBottom: space[6] + (playing ? TAB_BAR_HEIGHT : 0),
      }}
    />
  );
}

function CatalogueRow({ podcast }: { podcast: Podcast }) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/podcast/${podcast.id}`)}
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
        {podcast.author ? (
          <Text
            numberOfLines={1}
            style={[type('caption'), { color: theme.textTertiary, marginTop: 2 }]}
          >
            {podcast.author}
          </Text>
        ) : null}
      </View>
    </Pressable>
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
  categoryHeader: {
    paddingHorizontal: space[5],
    paddingBottom: space[4],
  },
  input: {
    minHeight: 48,
    paddingHorizontal: space[4],
    borderRadius: radius.full,
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
