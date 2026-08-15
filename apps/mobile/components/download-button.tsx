import { downloadProgress, type PlayableEpisode } from '@cue/core';
import { icon } from '@cue/design';
import { pressScale, spring, springRest } from '@cue/motion';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { DownloadRing, DownloadTrack, RING_SIZE } from '@/components/download-ring';
import { Icon } from '@/components/icon';
import { downloadActions, useDownloadRecord } from '@/lib/downloads/store';
import { useTranslator } from '@/lib/i18n';
import { space, useTheme } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Save an episode to the device, or get rid of it.
 *
 * One control across every state, matching the queue button next to it. From
 * the listener's side there is a single question — do I have this offline? —
 * and the answer moves between four values; splitting it into Download, Cancel,
 * Delete and Retry would be four controls answering the same question.
 *
 * The destructive half is deliberately not confirmed. Removing a download costs
 * a re-download, not data: everything about the episode is still on the server,
 * and a dialog to protect thirty megabytes is a dialog people learn to dismiss
 * without reading.
 */
export function DownloadButton({ episode }: { episode: PlayableEpisode }) {
  const t = useTranslator();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const record = useDownloadRecord(episode.id);
  const pressed = useSharedValue(0);

  const depth = pressScale(0.92, reduced);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - depth) }],
  }));

  const status = record?.status;
  const moving = status === 'queued' || status === 'downloading';
  const saved = status === 'complete';
  const failed = status === 'failed';

  const label = saved
    ? t.t('downloads.removeTitle', { title: episode.title })
    : moving
      ? t.t('downloads.cancel')
      : failed
        ? t.t('downloads.retry')
        : t.t('downloads.saveTitle', { title: episode.title });

  return (
    <AnimatedPressable
      onPress={() => {
        // Saved or in flight, the intention is the same: stop having this.
        if (record && status !== 'failed') {
          downloadActions.remove(episode.id);
          return;
        }
        downloadActions.save(episode);
      }}
      onPressIn={() => {
        pressed.value = withSpring(1, { ...spring.snappy, ...springRest });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, { ...spring.snappy, ...springRest });
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: saved, busy: moving }}
      accessibilityLabel={label}
      hitSlop={space[2]}
      style={[styles.button, animated]}
    >
      {record && moving ? (
        <>
          <DownloadTrack color={theme.textTertiary} />
          {/* Queued is honestly indeterminate: no bytes have moved yet, and a
              ring at zero would claim a transfer that has not begun. */}
          <DownloadRing
            progress={record.status === 'queued' ? null : downloadProgress(record)}
            color={theme.accentText}
          />
        </>
      ) : null}

      <Icon
        path={saved ? icon.downloaded : moving ? icon.close : icon.download}
        size={moving ? 14 : 20}
        color={saved ? theme.accentText : failed ? theme.danger : theme.textTertiary}
      />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: RING_SIZE + 6,
    height: RING_SIZE + 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
