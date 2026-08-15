import { queryKeys } from '@cue/api-client';
import { groupLibrary } from '@cue/core';
import { useTranslator } from '@/lib/i18n';
import { deriveTint, icon } from '@cue/design';
import type { LibraryPodcast } from '@cue/types';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '@/components/artwork';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { OfflineNotice } from '@/components/offline-notice';
import { ScreenMessage } from '@/components/screen-message';
import { api } from '@/lib/api';
import { useOnline } from '@/lib/connectivity';
import { useDownloadIndex } from '@/lib/downloads/store';
import { usePlayerState } from '@/lib/player/store';
import { useSession } from '@/lib/session';
import { TAB_BAR_HEIGHT, radius, space, type, useTheme } from '@/theme';

/**
 * The library, organised by your relationship to each show rather than by the
 * catalogue's alphabet: what is waiting, what is still running, what has ended.
 *
 * The grouping is the same function the web uses, from `@cue/core` — the two
 * platforms cannot disagree about what "gone quiet" means.
 */
export default function LibraryScreen() {
  const t = useTranslator();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn, isLoading: sessionLoading } = useSession();
  const playing = usePlayerState().current !== null;
  const online = useOnline();

  // Downloads belong to the handset, not the account, so this is counted even
  // when signed out — an episode saved before signing out is still on the phone.
  const savedCount = Object.keys(useDownloadIndex()).length;

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.library.subscriptions(),
    queryFn: () => api.listSubscriptions({ limit: 100 }),
    enabled: isSignedIn,
  });

  const groups = useMemo(() => groupLibrary(data?.items ?? []), [data]);

  /**
   * Groups flattened into one list, headings included.
   *
   * A virtualized list recycles a flat array, so the section structure has to
   * become items rather than nesting. Worth it: this screen fetches up to a
   * hundred shows, and a plain ScrollView mounts every one of them — a hundred
   * covers decoded and a hundred tints computed before the first row is
   * readable, on the device least able to afford it.
   */
  const rows = useMemo<LibraryItem[]>(
    () =>
      groups.flatMap((group) => [
        { kind: 'heading' as const, id: `heading:${group.id}`, title: group.title },
        ...group.items.map((podcast) => ({ kind: 'podcast' as const, id: podcast.id, podcast })),
      ]),
    [groups],
  );

  const header = (
    <View style={styles.header}>
      <Text style={[type('title1'), { color: theme.textPrimary }]}>{t.t('library.title')}</Text>

      <View style={styles.headerActions}>
        {/* Playlists live beside the library for the same reason downloads do:
            they are your things rather than a fourth place to look for
            something to listen to. */}
        <Pressable
          onPress={() => router.push('/playlists')}
          accessibilityRole="button"
          accessibilityLabel={t.t('playlists.title')}
          hitSlop={space[3]}
          style={styles.settings}
        >
          <Icon path={icon.queue} size={22} color={theme.textSecondary} />
        </Pressable>

        {/* Downloads belongs beside the library rather than in the tab bar:
            it is the same idea — your things — and a fourth tab that is empty
            until someone saves an episode is chrome advertising a feature they
            have not reached. It appears only once there is something in it. */}
        {savedCount > 0 ? (
          <Pressable
            onPress={() => router.push('/downloads')}
            accessibilityRole="button"
            accessibilityLabel={t.t('downloads.title')}
            hitSlop={space[3]}
            style={styles.settings}
          >
            <Icon path={icon.downloaded} size={22} color={theme.textSecondary} />
          </Pressable>
        ) : null}

        {/* Settings lives here rather than in the tab bar: it is not a place you
            go to find something to listen to, and Library is the screen whose
            contents depend on being signed in. */}
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel={t.t('nav.settings')}
          hitSlop={space[3]}
          style={styles.settings}
        >
          <Icon path={icon.settings} size={22} color={theme.textSecondary} />
        </Pressable>
      </View>
    </View>
  );

  // Signed-out and signed-in-with-nothing are different problems with
  // different fixes, so they are never collapsed into one empty state.
  if (!sessionLoading && !isSignedIn) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        {header}
        <ScreenMessage
          title={t.t('library.signedOut')}
          body={t.t('library.signedOutBody')}
          action={<Button label={t.t('common.signIn')} onPress={() => router.push('/signin')} />}
        />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      {header}

      {/* A failed request has two very different meanings, and only one of them
          is a fault. Offline is a situation with an answer — the downloads on
          this handset — so it gets its own state rather than being reported as
          a library that could not be loaded. */}
      {error ? (
        online ? (
          <ScreenMessage title={t.t('library.failed')} body={t.t('common.checkConnection')} />
        ) : (
          <OfflineNotice />
        )
      ) : null}

      {!error && (isPending || sessionLoading) ? <ScreenMessage title={t.t('common.loading')} /> : null}

      {!error && !isPending && groups.length === 0 ? (
        <ScreenMessage
          title={t.t('library.empty')}
          body={t.t('library.emptyBody')}
          action={<Button label={t.t('library.searchShows')} onPress={() => router.push('/search')} />}
        />
      ) : null}

      {rows.length > 0 ? (
        <FlashList
          data={rows}
          keyExtractor={(item) => item.id}
          // Headings and rows are different shapes, so they recycle into
          // separate pools. Without this the list reuses a heading's view for a
          // podcast row and has to rebuild it every time.
          getItemType={(item) => item.kind}
          renderItem={({ item }) =>
            item.kind === 'heading' ? (
              <Text style={[type('overline'), styles.heading, { color: theme.textTertiary }]}>
                {item.title.toUpperCase()}
              </Text>
            ) : (
              <LibraryRow podcast={item.podcast} />
            )
          }
          contentContainerStyle={{
            paddingHorizontal: space[4],
            // Clears the mini player when there is one, so the last row is
            // never parked underneath it.
            paddingBottom: space[6] + (playing ? TAB_BAR_HEIGHT : 0),
          }}
        />
      ) : null}
    </View>
  );
}

/** One entry in the flattened list: a group heading, or a show. */
type LibraryItem =
  | { kind: 'heading'; id: string; title: string }
  | { kind: 'podcast'; id: string; podcast: LibraryPodcast };

function LibraryRow({ podcast }: { podcast: LibraryPodcast }) {
  const t = useTranslator();
  const theme = useTheme();

  /**
   * Colour comes entirely from the artwork. Only the hue survives
   * `deriveTint` — lightness and chroma are re-fitted to this surface, because
   * a raw cover colour is as likely to be fluorescent lime as not.
   */
  const tint = useMemo(
    () => (podcast.accentColor ? deriveTint(podcast.accentColor, 'dark') : null),
    [podcast.accentColor],
  );

  const meta = [
    podcast.lastPublishedAt ? t.episodeDate(podcast.lastPublishedAt) : null,
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
            backgroundColor: pressed ? (tint?.wash ?? theme.surfaceHover) : 'transparent',
            borderRadius: radius.md,
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

        {podcast.newEpisodeCount > 0 ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: tint?.fill ?? theme.accent },
            ]}
          >
            <Text style={[type('caption'), { color: theme.textOnAccent }]}>
              {podcast.newEpisodeCount}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[5],
    paddingTop: space[6],
    paddingBottom: space[4],
  },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  settings: { padding: space[2] },
  // Top margin rather than a gap on a container: the group separation now has
  // to be carried by the heading itself, since there is no wrapper any more.
  heading: { marginTop: space[6], marginBottom: space[1] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[2],
  },
  rowText: { flex: 1 },
  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: space[2],
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
