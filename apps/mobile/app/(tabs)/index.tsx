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
import { useSession } from '@/lib/session';
import { TAB_BAR_HEIGHT, space, type, useTheme } from '@/theme';

/** How many shows the screen asks for, whichever list it ends up showing. */
const LIST_LIMIT = 30;

/**
 * Listen — the catalogue, ordered for whoever is reading it.
 *
 * FlashList rather than FlatList: it recycles row views instead of mounting
 * one per item, which is the difference between a smooth scroll and a
 * stuttering one once the catalogue has a few hundred shows.
 *
 * Two sources, one list. Signed in, the rows come from `/me/recommendations` —
 * the same shows, ordered by what this listener actually plays. Signed out, or
 * if that fails, they come from the shared catalogue exactly as before. The
 * list itself does not know or care which; only the heading changes, because
 * an order that is personal should say so and an order that is not should not
 * claim to be.
 */
export default function ListenScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const playing = usePlayerState().current !== null;
  const online = useOnline();
  const { isSignedIn } = useSession();

  const recommended = useQuery({
    queryKey: queryKeys.library.recommendations(),
    queryFn: () => api.getRecommendations({ limit: LIST_LIMIT }),
    enabled: isSignedIn,
    staleTime: staleTime.recommendations,
    retry: false,
  });

  /*
    Normally only one of these two requests happens.

    The recommendation endpoint already falls back to catalogue ordering for an
    account with no history, so for a signed-in listener the catalogue query is
    a second round trip for a list nobody is going to see. It is enabled only
    when there is no recommendation to wait for — signed out, or after the rail
    has actually failed.

    The exception is a cold start, where the session has not resolved yet and
    `isSignedIn` is still false, so both go out. That is deliberate rather than
    fixed: gating the catalogue on the session instead would put a `/me` round
    trip in front of the main screen for *every* visitor, signed in or not,
    which is a worse trade than one redundant request on the first launch of
    the app.
  */
  const usingRecommendations = isSignedIn && !recommended.isError;

  const catalogue = useQuery({
    queryKey: queryKeys.podcast.list(),
    queryFn: () => api.getPodcasts({ limit: LIST_LIMIT }),
    enabled: !usingRecommendations,
    staleTime: staleTime.podcast,
  });

  const source = usingRecommendations ? recommended : catalogue;
  const items = usingRecommendations
    ? (recommended.data?.items ?? [])
    : (catalogue.data?.items ?? []);

  const { isPending, error, refetch, isRefetching } = source;
  const personalized = usingRecommendations && items.length > 0;

  const renderItem = useCallback(
    ({ item }: { item: Podcast }) => <PodcastRow podcast={item} />,
    [],
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
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

      {!error && !isPending && items.length === 0 ? (
        <ScreenMessage
          title="Nothing here yet"
          body="Seed the local database with: npm run seed -w @cue/api"
        />
      ) : null}

      {items.length > 0 ? (
        <FlashList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          // Inside the list rather than above it, so what is in progress
          // scrolls away with the catalogue instead of pinning a band to the
          // top of a phone screen that has little enough height already.
          // An element rather than a component type: `ListenHeader` itself
          // stays one stable identity, so FlashList re-renders it instead of
          // tearing it down and rebuilding it on every list update.
          ListHeaderComponent={<ListenHeader personalized={personalized} />}
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
 * What sits above the list.
 *
 * Declared outside the screen component so its identity is stable across
 * renders — a header defined inline is a new component type every time, which
 * makes FlashList tear down and rebuild it on each list update.
 *
 * The heading is the only thing that reports which list this is. There is no
 * note underneath it as there is on the web, because a phone has no room for a
 * subtitle above the first row — and "Recommended for you" already says what
 * the order means.
 */
function ListenHeader({ personalized }: { personalized: boolean }) {
  const t = useTranslator();
  const theme = useTheme();

  return (
    <View>
      <Masthead />
      <ContinueListening />
      <Text style={[type('title2'), styles.catalogueHeading, { color: theme.textPrimary }]}>
        {t.t(personalized ? 'home.recommended' : 'home.catalogue')}
      </Text>
    </View>
  );
}

/**
 * The top of the screen.
 *
 * A stranger gets the product's name for the screen; someone signed in gets
 * the date and their own. That is the difference between arriving and
 * returning, and it is the cheapest possible way for a phone app to say it
 * kept your place.
 *
 * The date is computed on the device rather than sent from anywhere, which is
 * the only way to get it right — the server has no idea what timezone the
 * phone is in, and being confidently a day out is worse than not saying.
 */
function Masthead() {
  const t = useTranslator();
  const theme = useTheme();
  const { user } = useSession();

  const now = new Date();
  const name = user?.name?.trim();
  const today = new Intl.DateTimeFormat(t.locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);

  const hour = now.getHours();
  const greeting = name
    ? t.t(hour < 12 ? 'home.morning' : hour < 18 ? 'home.afternoon' : 'home.evening', {
        name,
      })
    : t.t('home.title');

  return (
    <View style={styles.header}>
      {name ? (
        <Text style={[type('overline'), { color: theme.textTertiary }]}>
          {today.toUpperCase()}
        </Text>
      ) : null}
      <Text style={[type('display'), { color: theme.textPrimary, marginTop: 3 }]}>
        {greeting}
      </Text>
      {name ? null : (
        <Text style={[type('callout'), { color: theme.textSecondary, marginTop: space[2] }]}>
          {t.t('home.lede')}
        </Text>
      )}
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
    paddingTop: space[5],
    paddingBottom: space[6],
  },
  catalogueHeading: { paddingHorizontal: space[5], paddingBottom: space[3] },
  row: {
    flexDirection: 'row',
    gap: space[4],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, justifyContent: 'center' },
});
