import { queryKeys } from '@cue/api-client';
import { playableFromQueueEntry } from '@cue/core';
import { icon } from '@cue/design';
import type { PlaylistEntry } from '@cue/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '@/components/artwork';
import { Button } from '@/components/button';
import { CoverStack } from '@/components/cover-stack';
import { Icon } from '@/components/icon';
import { PlayButton } from '@/components/play-button';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenMessage } from '@/components/screen-message';
import { api } from '@/lib/api';
import { useTranslator } from '@/lib/i18n';
import { playerActions } from '@/lib/player/store';
import { TAB_BAR_HEIGHT, space, type, useTheme } from '@/theme';

/**
 * One playlist.
 *
 * Reordering is by explicit move controls rather than by dragging, matching the
 * queue screen and for the same reason: a drag on a scrolling list needs
 * long-press arming, auto-scroll at the edges, and a screen-reader fallback to
 * be correct — and the move buttons *are* that fallback, so they are what ships
 * until the drag can be built and tested on a real device.
 */
export default function PlaylistScreen() {
  const t = useTranslator();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.playlists.detail(id),
    queryFn: () => api.getPlaylist(id),
  });

  const playlist = data?.playlist;
  const items = playlist?.items ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
  };

  const reorder = useMutation({
    mutationFn: (episodeIds: string[]) => api.reorderPlaylist(id, episodeIds),
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (episodeId: string) => api.removeFromPlaylist(id, episodeId),
    onSettled: invalidate,
  });

  const destroy = useMutation({
    mutationFn: () => api.deletePlaylist(id),
    onSuccess: () => {
      invalidate();
      router.back();
    },
  });

  const back = (
    <PressableScale
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel={t.t('episode.back')}
      hitSlop={space[3]}
      scale={0.9}
      style={styles.back}
    >
      <View style={styles.backIcon}>
        <Icon path={icon.chevronDown} size={26} color={theme.textSecondary} />
      </View>
    </PressableScale>
  );

  if (error) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        {back}
        <ScreenMessage title={t.t('playlists.notFound')} body={t.t('common.checkConnection')} />
      </View>
    );
  }

  if (isPending || !playlist) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        {back}
        <ScreenMessage title={t.t('common.loading')} />
      </View>
    );
  }

  /**
   * Move one item and push the whole resulting order.
   *
   * The endpoint takes an order rather than a move, which makes this idempotent
   * — replaying it cannot walk an episode twice down the list the way a
   * relative "move down" would.
   */
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;

    const ids = items.map((item) => item.episode.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved!);

    reorder.mutate(ids);
  };

  /**
   * Play the whole thing.
   *
   * The first episode starts and the rest queue behind it. Replacing the queue
   * outright would throw away whatever was already lined up, which is not what
   * "play all" means anywhere else.
   */
  const playAll = () => {
    const playables = items.map(playableFromQueueEntry);
    const [first, ...rest] = playables;
    if (!first) return;

    void playerActions.play(first);
    if (rest.length > 0) playerActions.enqueue(...rest);
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      {back}

      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + space[8] + TAB_BAR_HEIGHT,
        }}
      >
        <View style={styles.hero}>
          <CoverStack artworkUrls={playlist.artworkUrls} title={playlist.title} size={140} />

          <Text style={[type('title2'), { color: theme.textPrimary, marginTop: space[4] }]}>
            {playlist.title}
          </Text>
          <Text style={[type('caption'), { color: theme.textTertiary, marginTop: space[1] }]}>
            {t.t('playlists.count', { count: playlist.itemCount })}
          </Text>

          {playlist.description ? (
            <Text
              style={[type('callout'), { color: theme.textSecondary, marginTop: space[3] }]}
            >
              {playlist.description}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Button
              label={t.t('playlists.playAll')}
              onPress={playAll}
              disabled={items.length === 0}
            />
            <Button
              label={t.t('playlists.delete')}
              variant="secondary"
              onPress={() => {
                // The platform's own confirm. This is the one destructive
                // action in the app, it is rare, and Android already asks this
                // question better than a bespoke sheet would.
                Alert.alert(
                  playlist.title,
                  t.t('playlists.deleteConfirm', { title: playlist.title }),
                  [
                    { text: t.t('common.cancel'), style: 'cancel' },
                    {
                      text: t.t('common.remove'),
                      style: 'destructive',
                      onPress: () => destroy.mutate(),
                    },
                  ],
                );
              }}
            />
          </View>
        </View>

        {items.length === 0 ? (
          <ScreenMessage
            title={t.t('playlists.noEpisodes')}
            body={t.t('playlists.noEpisodesBody')}
          />
        ) : (
          items.map((entry, index) => (
            <PlaylistRow
              key={entry.episode.id}
              entry={entry}
              position={index + 1}
              isFirst={index === 0}
              isLast={index === items.length - 1}
              onMove={(direction) => move(index, direction)}
              onRemove={() => remove.mutate(entry.episode.id)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function PlaylistRow({
  entry,
  position,
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  entry: PlaylistEntry;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslator();
  const theme = useTheme();

  const playable = playableFromQueueEntry(entry);
  const length = t.duration(entry.episode.durationSec);

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Text
        style={[type('caption'), styles.position, { color: theme.textTertiary }]}
        accessibilityElementsHidden
      >
        {position}
      </Text>

      <Artwork url={playable.artworkUrl} size={44} />

      <View style={styles.rowText}>
        <Text numberOfLines={2} style={[type('body'), { color: theme.textPrimary }]}>
          {entry.episode.title}
        </Text>
        <Text numberOfLines={1} style={[type('caption'), { color: theme.textTertiary }]}>
          {entry.podcastTitle}
          {length ? ` · ${length}` : ''}
        </Text>
      </View>

      <View style={styles.controls}>
        <MoveButton
          label={t.t('playlists.moveUp', { title: entry.episode.title })}
          direction={-1}
          disabled={isFirst}
          onPress={onMove}
        />
        <MoveButton
          label={t.t('playlists.moveDown', { title: entry.episode.title })}
          direction={1}
          disabled={isLast}
          onPress={onMove}
        />

        <PlayButton episode={playable} size={36} />

        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={t.t('playlists.removeTitle', { title: entry.episode.title })}
          hitSlop={space[2]}
          style={({ pressed }) => [
            styles.control,
            pressed && { backgroundColor: theme.surfaceHover },
          ]}
        >
          <Icon path={icon.close} size={18} color={theme.textTertiary} />
        </Pressable>
      </View>
    </View>
  );
}

function MoveButton({
  label,
  direction,
  disabled,
  onPress,
}: {
  label: string;
  direction: -1 | 1;
  disabled: boolean;
  onPress: (direction: -1 | 1) => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => onPress(direction)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={space[1]}
      style={({ pressed }) => [
        styles.control,
        { opacity: disabled ? 0.25 : 1 },
        pressed && { backgroundColor: theme.surfaceHover },
      ]}
    >
      {/* One chevron path, flipped — the same geometry the rest of the app
          uses for "down". */}
      <View style={direction === -1 ? styles.flipped : undefined}>
        <Icon path={icon.chevronDown} size={18} color={theme.textSecondary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { padding: space[3], alignSelf: 'flex-start' },
  backIcon: { transform: [{ rotate: '90deg' }] },
  hero: { paddingHorizontal: space[5], paddingBottom: space[6] },
  actions: { flexDirection: 'row', gap: space[3], marginTop: space[5] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  position: { width: 18, textAlign: 'right' },
  rowText: { flex: 1, gap: 2 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  control: {
    width: 32,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipped: { transform: [{ rotate: '180deg' }] },
});
