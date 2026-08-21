import {
  downloadedBytes,
  downloadProgress,
  formatBytes,
  listDownloads,
  playableFromDownload,
  type DownloadRecord,
} from '@cue/core';
import { icon } from '@cue/design';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '@/components/artwork';
import { DownloadRing, DownloadTrack } from '@/components/download-ring';
import { Icon } from '@/components/icon';
import { PlayButton } from '@/components/play-button';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenMessage } from '@/components/screen-message';
import { downloadActions, useDownloadIndex } from '@/lib/downloads/store';
import { useTranslator } from '@/lib/i18n';
import { space, type, useTheme } from '@/theme';

/**
 * Everything saved to this handset.
 *
 * The one screen in the app that is fully functional with no network at all —
 * which is why it renders from the download index rather than from a query. The
 * index carries each episode's title, show and artwork for exactly this reason:
 * on a plane there is nobody to ask.
 *
 * It doubles as the storage screen. An app that will happily fill a phone and
 * offers no way to see what it took is an app people delete.
 */
export default function DownloadsScreen() {
  const t = useTranslator();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const index = useDownloadIndex();
  const records = listDownloads(index);
  const saved = records.filter((record) => record.status === 'complete');
  const bytes = downloadedBytes(index);

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t.t('episode.back')}
          hitSlop={space[3]}
          scale={0.94}
          style={styles.dismiss}
        >
          <Icon path={icon.chevronDown} size={26} color={theme.textSecondary} />
        </PressableScale>

        <View style={styles.headerText}>
          <Text style={[type('title2'), { color: theme.textPrimary }]}>
            {t.t('downloads.title')}
          </Text>

          {saved.length > 0 ? (
            <Text style={[type('caption'), { color: theme.textSecondary, marginTop: space[1] }]}>
              {t.t('downloads.count', { count: saved.length })} ·{' '}
              {t.t('downloads.usage', { size: formatBytes(bytes) })}
            </Text>
          ) : null}
        </View>
      </View>

      {records.length === 0 ? (
        <ScreenMessage title={t.t('downloads.empty')} body={t.t('downloads.emptyBody')} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space[10] }}>
          {records.map((record) => (
            <DownloadRow key={record.episodeId} record={record} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function DownloadRow({ record }: { record: DownloadRecord }) {
  const t = useTranslator();
  const theme = useTheme();

  const episode = playableFromDownload(record);
  const progress = downloadProgress(record);
  const moving = record.status === 'queued' || record.status === 'downloading';

  /**
   * The second line says what this row *is*, and that changes with status.
   *
   * A saved episode wants its length and size — that is what someone deciding
   * whether to free space needs. One in flight wants how far it has got. One
   * that failed wants the reason, in the publisher's or the device's terms,
   * rather than "Error".
   */
  const detail =
    record.status === 'complete'
      ? [t.duration(record.durationSec), formatBytes(record.bytesWritten)].filter(Boolean).join(' · ')
      : record.status === 'failed'
        ? (record.error ?? t.t('downloads.failed'))
        : record.status === 'queued'
          ? t.t('downloads.waiting')
          : progress === null
            ? t.t('downloads.working')
            : `${t.t('downloads.working')} · ${Math.round(progress * 100)}%`;

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Artwork url={episode.artworkUrl} size={52} />

      <View style={styles.rowText}>
        <Text numberOfLines={2} style={[type('body'), { color: theme.textPrimary }]}>
          {record.title}
        </Text>
        <Text numberOfLines={1} style={[type('caption'), { color: theme.textTertiary }]}>
          {record.podcastTitle}
        </Text>
        <Text
          numberOfLines={1}
          style={[
            type('caption'),
            { color: record.status === 'failed' ? theme.danger : theme.textSecondary },
          ]}
        >
          {detail}
        </Text>
      </View>

      {/* A download still arriving cannot be played, so the play control is
          replaced by its own progress rather than sitting there disabled. */}
      {moving ? (
        <View style={styles.ring}>
          <DownloadTrack color={theme.textTertiary} />
          <DownloadRing
            progress={record.status === 'queued' ? null : progress}
            color={theme.accentText}
          />
        </View>
      ) : record.status === 'complete' ? (
        <PlayButton episode={episode} />
      ) : (
        <PressableScale
          onPress={() => downloadActions.retry(episode)}
          accessibilityRole="button"
          accessibilityLabel={t.t('downloads.retry')}
          hitSlop={space[2]}
          scale={0.94}
          style={styles.action}
        >
          <Icon path={icon.download} size={20} color={theme.textSecondary} />
        </PressableScale>
      )}

      <PressableScale
        onPress={() => downloadActions.remove(record.episodeId)}
        accessibilityRole="button"
        accessibilityLabel={
          moving
            ? t.t('downloads.cancel')
            : t.t('downloads.removeTitle', { title: record.title })
        }
        hitSlop={space[2]}
        scale={0.94}
        style={styles.action}
      >
        <Icon path={moving ? icon.close : icon.trash} size={20} color={theme.textTertiary} />
      </PressableScale>
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
  headerText: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  ring: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
