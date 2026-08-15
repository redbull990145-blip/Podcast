import { playableFromEpisode } from '@cue/core';
import { useTranslator } from '@/lib/i18n';
import type { Episode } from '@cue/types';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Artwork } from '@/components/artwork';
import { DownloadButton } from '@/components/download-button';
import { PlayButton } from '@/components/play-button';
import { QueueButton } from '@/components/queue-button';
import { usePlayerState } from '@/lib/player/store';
import { space, type, useTheme } from '@/theme';

/**
 * One episode in a list.
 *
 * The metadata line is assembled from whatever the feed actually provided.
 * Duration is routinely missing, and a row that renders "0:00" for it looks
 * broken in a way that "no duration shown" does not.
 */
export function EpisodeRow({
  episode,
  podcastTitle,
  fallbackArtwork,
  accentColor,
}: {
  episode: Episode;
  podcastTitle: string;
  fallbackArtwork: string | null;
  accentColor: string | null;
}) {
  const t = useTranslator();
  const theme = useTheme();
  const state = usePlayerState();

  const isCurrent = state.current?.id === episode.id;
  const artwork = episode.artworkUrl ?? fallbackArtwork;

  const playable = playableFromEpisode(episode, {
    title: podcastTitle,
    artworkUrl: fallbackArtwork,
    accentColor,
  });

  const meta = [t.episodeDate(episode.publishedAt), t.duration(episode.durationSec)]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Artwork url={artwork} size={52} />

      {/* The text block is the link, not the whole row: the row also holds two
          buttons, and a wrapping pressable would make every play tap a
          navigation on anything but a perfect hit. */}
      <Link href={`/episode/${episode.id}`} asChild>
        <Pressable accessibilityRole="link" style={styles.text}>
          <Text
            numberOfLines={2}
            style={[
              type('body'),
              { color: isCurrent ? theme.accentText : theme.textPrimary },
            ]}
          >
            {episode.title}
          </Text>

          {meta ? (
            <Text style={[type('caption'), { color: theme.textTertiary, marginTop: space[1] }]}>
              {meta}
            </Text>
          ) : null}
        </Pressable>
      </Link>

      <DownloadButton episode={playable} />
      <QueueButton episode={playable} />
      <PlayButton episode={playable} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1 },
});
