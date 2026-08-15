import { queryKeys } from '@cue/api-client';
import { icon } from '@cue/design';
import { PLAYLIST_TITLE_MAX } from '@cue/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { useTranslator } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { radius, space, type, useTheme } from '@/theme';

/**
 * Put this episode in a playlist.
 *
 * A sheet of tick rows rather than a "pick a playlist" screen, because the
 * question is almost always *which of mine* and the answer is often more than
 * one. Membership arrives in a single request, so the ticks are right the
 * moment it opens instead of filling in a row at a time.
 *
 * Absent entirely when signed out. Playlists live on the account, and a control
 * whose only outcome is a sign-in prompt is a control that wasted a tap.
 */
export function AddToPlaylist({ episodeId }: { episodeId: string }) {
  const t = useTranslator();
  const theme = useTheme();
  const { isSignedIn } = useSession();
  const [open, setOpen] = useState(false);

  if (!isSignedIn) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t.t('playlists.addTo')}
        hitSlop={space[2]}
        style={styles.trigger}
      >
        <Icon path={icon.library} size={20} color={theme.textTertiary} />
      </Pressable>

      {/* Mounted only while open: a Modal that is always in the tree keeps its
          queries alive on every episode row in a list. */}
      {open ? <Sheet episodeId={episodeId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Sheet({ episodeId, onClose }: { episodeId: string; onClose: () => void }) {
  const t = useTranslator();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');

  const playlists = useQuery({
    queryKey: queryKeys.playlists.list(),
    queryFn: () => api.listPlaylists({ limit: 100 }),
  });

  const membership = useQuery({
    queryKey: queryKeys.playlists.containing(episodeId),
    queryFn: () => api.playlistsContaining(episodeId),
  });

  const held = new Set(membership.data?.playlistIds ?? []);

  const invalidate = () => {
    // Everything under `playlists` — the list's counts and covers change
    // alongside the membership this row just edited.
    void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
  };

  const toggle = useMutation({
    mutationFn: async ({ playlistId, add }: { playlistId: string; add: boolean }) => {
      if (add) await api.addToPlaylist(playlistId, episodeId);
      else await api.removeFromPlaylist(playlistId, episodeId);
    },
    onSettled: invalidate,
  });

  const create = useMutation({
    mutationFn: async (name: string) => {
      const { playlist } = await api.createPlaylist({ title: name });
      // Created *and* filled: naming a playlist with an episode in hand is
      // naming it for that episode.
      await api.addToPlaylist(playlist.id, episodeId);
    },
    onSettled: invalidate,
  });

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      // Android's own back gesture closes it, which is the dismissal people
      // reach for before they look for a button.
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t.t('common.cancel')}
        style={[styles.scrim, { backgroundColor: theme.scrim }]}
      />

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.surfaceOverlay,
            borderColor: theme.border,
            paddingBottom: insets.bottom + space[4],
          },
        ]}
      >
        <Text style={[type('title3'), styles.heading, { color: theme.textPrimary }]}>
          {t.t('playlists.addTo')}
        </Text>

        {playlists.isPending ? (
          <Text style={[type('callout'), styles.status, { color: theme.textTertiary }]}>
            {t.t('common.loading')}
          </Text>
        ) : (playlists.data?.items.length ?? 0) === 0 ? (
          <Text style={[type('callout'), styles.status, { color: theme.textSecondary }]}>
            {t.t('playlists.emptyBody')}
          </Text>
        ) : (
          <ScrollView style={styles.list}>
            {(playlists.data?.items ?? []).map((playlist) => {
              const inIt = held.has(playlist.id);

              return (
                <Pressable
                  key={playlist.id}
                  onPress={() => toggle.mutate({ playlistId: playlist.id, add: !inIt })}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: inIt }}
                  accessibilityLabel={playlist.title}
                  style={({ pressed }) => [
                    styles.option,
                    { backgroundColor: pressed ? theme.surfaceHover : 'transparent' },
                  ]}
                >
                  <View style={styles.tick}>
                    {inIt ? (
                      <Icon path={icon.check} size={18} color={theme.accentText} />
                    ) : null}
                  </View>

                  <Text
                    numberOfLines={1}
                    style={[type('body'), styles.optionLabel, { color: theme.textPrimary }]}
                  >
                    {playlist.title}
                  </Text>

                  <Text style={[type('caption'), { color: theme.textTertiary }]}>
                    {playlist.episodeCount}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t.t('playlists.create')}
          placeholderTextColor={theme.textTertiary}
          maxLength={PLAYLIST_TITLE_MAX}
          accessibilityLabel={t.t('playlists.create')}
          returnKeyType="done"
          onSubmitEditing={() => {
            const name = title.trim();
            if (name.length === 0) return;
            create.mutate(name);
            setTitle('');
          }}
          style={[
            type('body'),
            styles.input,
            {
              borderColor: theme.border,
              color: theme.textPrimary,
              backgroundColor: theme.surface,
            },
          ]}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: { flex: 1 },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space[4],
    paddingTop: space[5],
  },
  heading: { marginBottom: space[3] },
  status: { paddingVertical: space[4] },
  list: { maxHeight: 280 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 48,
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
  },
  tick: { width: 20, alignItems: 'center' },
  optionLabel: { flex: 1 },
  input: {
    minHeight: 48,
    marginTop: space[3],
    paddingHorizontal: space[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
});
