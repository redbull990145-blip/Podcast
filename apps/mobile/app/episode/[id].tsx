import { queryKeys, staleTime } from '@cue/api-client';
import { formatTimestamp, parseShareTime, playableFromEpisode } from '@cue/core';
import { useTranslator } from '@/lib/i18n';
import { deriveTint, icon } from '@cue/design';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddToPlaylist } from '@/components/add-to-playlist';
import { Artwork } from '@/components/artwork';
import { Button } from '@/components/button';
import { DownloadButton } from '@/components/download-button';
import { Icon } from '@/components/icon';
import { PlayButton } from '@/components/play-button';
import { QueueButton } from '@/components/queue-button';
import { ScreenMessage } from '@/components/screen-message';
import { ShareButton } from '@/components/share-button';
import { api } from '@/lib/api';
import { playerActions, usePlayerState } from '@/lib/player/store';
import { TAB_BAR_HEIGHT, radius, space, type, useTheme } from '@/theme';

/**
 * One episode.
 *
 * Shows the plain-text description rather than the publisher's HTML. The web
 * renders the sanitised markup because a browser already has a renderer for
 * it; doing the same natively means shipping an HTML engine to gain some bold
 * text and a few links, which is not a trade worth making. The API stores both
 * forms, so this is a choice rather than a limitation.
 */
export default function EpisodeScreen() {
  const t = useTranslator();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // `t` arrives on a shared link — `cue://episode/<id>?t=24m31s`.
  const { id, t: sharedAt } = useLocalSearchParams<{ id: string; t?: string }>();
  const playing = usePlayerState().current !== null;

  const { data, error, isPending } = useQuery({
    queryKey: queryKeys.episode.detail(id),
    queryFn: () => api.getEpisode(id),
    staleTime: staleTime.episodes,
  });

  const episode = data?.episode;

  const { data: podcastData } = useQuery({
    queryKey: queryKeys.podcast.detail(episode?.podcastId ?? ''),
    queryFn: () => api.getPodcast(episode!.podcastId),
    // Only once the episode has told us which show it belongs to.
    enabled: Boolean(episode?.podcastId),
    staleTime: staleTime.podcast,
  });

  const podcast = podcastData?.podcast;

  const tint = useMemo(
    () => (podcast?.accentColor ? deriveTint(podcast.accentColor, 'dark') : null),
    [podcast?.accentColor],
  );

  const back = (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel={t.t('episode.back')}
      hitSlop={space[3]}
      style={styles.back}
    >
      <View style={styles.backIcon}>
        <Icon path={icon.chevronDown} size={26} color={theme.textSecondary} />
      </View>
    </Pressable>
  );

  if (error) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        {back}
        <ScreenMessage
          title={t.t('episode.failed')}
          body={t.t('episode.failedBody')}
        />
      </View>
    );
  }

  if (isPending || !episode) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        {back}
        <ScreenMessage title={t.t('common.loading')} />
      </View>
    );
  }

  const artwork = episode.artworkUrl ?? podcast?.artworkUrl ?? null;
  const length = t.duration(episode.durationSec);
  const playable = playableFromEpisode(episode, {
    title: podcast?.title ?? '',
    artworkUrl: podcast?.artworkUrl ?? null,
    accentColor: podcast?.accentColor ?? null,
  });

  /**
   * A shared moment, if this page was opened by one.
   *
   * Null for a link that was mangled, and null for one that points past the end
   * of the episode — better to show nothing than to offer a jump into silence.
   */
  const parsed = parseShareTime(sharedAt ?? null);
  const sharedFrom =
    parsed !== null && (episode.durationSec === null || parsed < episode.durationSec)
      ? parsed
      : null;

  const meta = [
    t.episodeDate(episode.publishedAt),
    length,
    episode.seasonNumber !== null && episode.episodeNumber !== null
      ? `S${episode.seasonNumber} E${episode.episodeNumber}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      {back}

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space[5],
          paddingBottom: insets.bottom + space[8] + (playing ? TAB_BAR_HEIGHT : 0),
        }}
      >
        {/* An ambient wash of the show's own colour, felt rather than seen. */}
        {tint ? (
          <View style={[styles.wash, { backgroundColor: tint.wash }]} pointerEvents="none" />
        ) : null}

        <View style={styles.hero}>
          <Artwork url={artwork} size={168} label={podcast?.title ?? episode.title} />
        </View>

        {podcast ? (
          <Link href={`/podcast/${podcast.id}`} asChild>
            <Pressable accessibilityRole="link" style={styles.showLink}>
              <Text
                style={[type('callout'), { color: tint?.text ?? theme.textSecondary }]}
                numberOfLines={1}
              >
                {podcast.title}
              </Text>
            </Pressable>
          </Link>
        ) : null}

        <Text style={[type('title2'), { color: theme.textPrimary, marginTop: space[1] }]}>
          {episode.title}
        </Text>

        {meta ? (
          <Text style={[type('caption'), { color: theme.textTertiary, marginTop: space[2] }]}>
            {meta}
          </Text>
        ) : null}

        {/* Somebody sent this. A prompt rather than autoplay: a link tapped out
            of a chat usually arrives while something else is already playing,
            and interrupting it uninvited is not a welcome. */}
        {sharedFrom !== null ? (
          <View style={[styles.shared, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}>
            <Text style={[type('callout'), { color: theme.textSecondary }]}>
              {t.t('share.sharedFrom', { time: formatTimestamp(sharedFrom) })}
            </Text>
            <Button
              label={t.t('share.playFrom', { time: formatTimestamp(sharedFrom) })}
              onPress={() => void playerActions.playAt(playable, sharedFrom)}
            />
          </View>
        ) : null}

        <View style={styles.actions}>
          <PlayButton episode={playable} size={52} />
          <QueueButton episode={playable} />
          <DownloadButton episode={playable} />
          <AddToPlaylist episodeId={episode.id} />
          <ShareButton episodeId={episode.id} title={episode.title} />
        </View>

        {/* Above the notes rather than below them: this is the short version,
            and putting it under a publisher's thousand-word show notes makes it
            findable only by people who did not need it. */}
        <Button
          label={t.t('ai.open')}
          variant="secondary"
          onPress={() => router.push(`/ai/${episode.id}`)}
          style={styles.aiButton}
        />

        {episode.description ? (
          <Text style={[type('body'), { color: theme.textSecondary, marginTop: space[6] }]}>
            {episode.description}
          </Text>
        ) : (
          <Text style={[type('callout'), { color: theme.textTertiary, marginTop: space[6] }]}>
            {t.t('episode.noNotes')}
          </Text>
        )}

        {episode.transcriptUrl ? (
          <View style={styles.transcript}>
            <Text style={[type('title3'), { color: theme.textPrimary }]}>{t.t('transcript.title')}</Text>
            <Text
              style={[type('callout'), { color: theme.textSecondary, marginTop: space[2] }]}
            >
              {t.t('transcript.available')}
            </Text>
            {/* Read in the app rather than handed to the browser. It used to
                open the publisher's page, which made the two things a
                transcript is *for* — following along, and jumping to the bit
                you half-remember — someone else's, and impossible while the
                episode is playing here. */}
            <Button
              label={t.t('transcript.read')}
              variant="secondary"
              onPress={() => router.push(`/transcript/${episode.id}`)}
              style={styles.transcriptButton}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { padding: space[3], alignSelf: 'flex-start' },
  backIcon: { transform: [{ rotate: '90deg' }] },
  wash: {
    position: 'absolute',
    top: -space[10],
    left: -space[10],
    right: -space[10],
    height: 240,
  },
  hero: { alignItems: 'center', paddingVertical: space[4] },
  showLink: { alignSelf: 'flex-start', paddingVertical: space[1] },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space[3],
    marginTop: space[5],
  },
  shared: {
    gap: space[3],
    marginTop: space[5],
    padding: space[4],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  aiButton: { marginTop: space[5], alignSelf: 'flex-start' },
  transcript: { marginTop: space[8] },
  transcriptButton: { marginTop: space[4], alignSelf: 'flex-start' },
});
