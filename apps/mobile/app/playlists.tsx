import { queryKeys } from '@cue/api-client';
import { icon } from '@cue/design';
import type { Playlist } from '@cue/types';
import { PLAYLIST_TITLE_MAX } from '@cue/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { CoverStack } from '@/components/cover-stack';
import { Icon } from '@/components/icon';
import { ScreenMessage } from '@/components/screen-message';
import { api } from '@/lib/api';
import { useTranslator } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { radius, space, type, useTheme } from '@/theme';

/**
 * Every playlist this listener has.
 *
 * Signed-in only, and honestly so. A playlist is built over weeks and expected
 * to still be there — keeping one in device storage until an uninstall takes it
 * would be worse than saying up front that it needs an account.
 */
export default function PlaylistsScreen() {
  const t = useTranslator();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn, isLoading } = useSession();

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.playlists.list(),
    queryFn: () => api.listPlaylists({ limit: 100 }),
    enabled: isSignedIn,
  });

  const playlists = data?.items ?? [];

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t.t('episode.back')}
          hitSlop={space[3]}
          style={styles.dismiss}
        >
          <Icon path={icon.chevronDown} size={26} color={theme.textSecondary} />
        </Pressable>

        <Text style={[type('title2'), { color: theme.textPrimary }]}>
          {t.t('playlists.title')}
        </Text>
      </View>

      {isLoading ? null : !isSignedIn ? (
        <ScreenMessage
          title={t.t('playlists.signedOut')}
          body={t.t('playlists.signedOutBody')}
          action={<Button label={t.t('common.signIn')} onPress={() => router.push('/signin')} />}
        />
      ) : error ? (
        <ScreenMessage title={t.t('playlists.failed')} body={t.t('common.checkConnection')} />
      ) : isPending ? (
        <ScreenMessage title={t.t('common.loading')} />
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: space[5],
            paddingBottom: insets.bottom + space[10],
          }}
        >
          <CreatePlaylist />

          {playlists.length === 0 ? (
            <ScreenMessage title={t.t('playlists.empty')} body={t.t('playlists.emptyBody')} />
          ) : (
            playlists.map((playlist) => <PlaylistRow key={playlist.id} playlist={playlist} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}

function PlaylistRow({ playlist }: { playlist: Playlist }) {
  const t = useTranslator();
  const theme = useTheme();

  return (
    <Link href={`/playlist/${playlist.id}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={playlist.title}
        style={({ pressed }) => [
          styles.row,
          {
            borderBottomColor: theme.border,
            backgroundColor: pressed ? theme.surfaceHover : 'transparent',
          },
        ]}
      >
        <CoverStack artworkUrls={playlist.artworkUrls} title={playlist.title} size={56} />

        <View style={styles.rowText}>
          <Text numberOfLines={2} style={[type('bodyStrong'), { color: theme.textPrimary }]}>
            {playlist.title}
          </Text>
          <Text style={[type('caption'), { color: theme.textTertiary, marginTop: 2 }]}>
            {t.t('playlists.count', { count: playlist.episodeCount })}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

/**
 * Making one.
 *
 * A disclosure rather than a form that is always open: the usual reason to be
 * here is to open a playlist, and a permanently visible text field pushes the
 * list itself down a phone screen that has little height to spare.
 */
function CreatePlaylist() {
  const t = useTranslator();
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  const create = useMutation({
    mutationFn: (name: string) => api.createPlaylist({ title: name }),
    onSuccess: () => {
      setTitle('');
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    },
  });

  if (!open) {
    return (
      <Button
        label={t.t('playlists.create')}
        variant="secondary"
        onPress={() => setOpen(true)}
        style={styles.create}
      />
    );
  }

  const submit = () => {
    const name = title.trim();
    if (name.length === 0) return;
    create.mutate(name);
  };

  return (
    <View style={[styles.form, { borderColor: theme.border }]}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder={t.t('playlists.namePlaceholder')}
        placeholderTextColor={theme.textTertiary}
        maxLength={PLAYLIST_TITLE_MAX}
        accessibilityLabel={t.t('playlists.name')}
        // The field appeared because it was asked for, so it takes the caret
        // rather than making someone tap a second time to start typing.
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
        style={[
          type('body'),
          styles.input,
          { borderColor: theme.border, color: theme.textPrimary, backgroundColor: theme.surface },
        ]}
      />

      <View style={styles.formActions}>
        <Button
          label={create.isPending ? t.t('playlists.creating') : t.t('playlists.create')}
          onPress={submit}
          disabled={create.isPending || title.trim().length === 0}
        />
        <Button
          label={t.t('common.cancel')}
          variant="secondary"
          onPress={() => {
            setOpen(false);
            setTitle('');
          }}
        />
      </View>

      {create.error ? (
        <Text style={[type('caption'), { color: theme.danger }]}>{create.error.message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[4],
  },
  dismiss: { padding: space[1] },
  create: { alignSelf: 'flex-start', marginBottom: space[6] },
  form: {
    gap: space[3],
    padding: space[4],
    marginBottom: space[6],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: space[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  formActions: { flexDirection: 'row', gap: space[3] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
});
