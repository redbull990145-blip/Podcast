import { queryKeys, type AiPanelState } from '@cue/api-client';
import { formatTimestamp, playableFromEpisode, seekTargetSec } from '@cue/core';
import { icon } from '@cue/design';
import type { AskCitation } from '@cue/types';
import { QUESTION_MAX } from '@cue/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { MiniPlayer } from '@/components/mini-player';
import { ScreenMessage } from '@/components/screen-message';
import { api } from '@/lib/api';
import { playerActions, usePlayerState } from '@/lib/player/store';
import { radius, space, type, useTheme } from '@/theme';

const MINI_PLAYER_CLEARANCE = 64;

/**
 * What the model made of this episode.
 *
 * Its own screen rather than a section of the episode page, for the same reason
 * the transcript is: the episode screen is a `ScrollView` full of show notes,
 * and a streaming answer plus a chapter list plus a summary underneath all of
 * that is a scroll nobody reaches the bottom of.
 *
 * Nothing here generates on arrival. Opening this screen reads the shared cache
 * and spends nothing; every model call is behind a button that says what it
 * will do. Burning someone's daily allowance because they tapped into an
 * episode is the failure this shape exists to prevent.
 */
export default function AiScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const client = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const state = usePlayerState();

  const { data: episodeData } = useQuery({
    queryKey: queryKeys.episode.detail(id),
    queryFn: () => api.getEpisode(id),
  });

  const episode = episodeData?.episode;

  const { data: podcastData } = useQuery({
    queryKey: queryKeys.podcast.detail(episode?.podcastId ?? ''),
    queryFn: () => api.getPodcast(episode!.podcastId),
    enabled: Boolean(episode?.podcastId),
  });

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.episode.ai(id),
    queryFn: ({ signal }) => api.getEpisodeAi(id, { signal }),
    staleTime: 30_000,
  });

  const transcribing = data?.transcript.status === 'processing';

  // Polled only while a transcription is running — it is the one operation that
  // finishes without the client doing anything.
  useEffect(() => {
    if (!transcribing) return;

    const timer = setInterval(() => {
      void client.invalidateQueries({ queryKey: queryKeys.episode.ai(id) });
      void client.invalidateQueries({ queryKey: queryKeys.episode.transcript(id) });
    }, 5000);

    return () => clearInterval(timer);
  }, [transcribing, client, id]);

  const patch = (next: Partial<AiPanelState>) => {
    client.setQueryData<AiPanelState>(queryKeys.episode.ai(id), (previous) =>
      previous ? { ...previous, ...next } : previous,
    );
  };

  const transcribe = useMutation({
    mutationFn: () => api.transcribeEpisode(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.episode.ai(id) }),
  });

  const brief = useMutation({
    mutationFn: () => api.generateBrief(id),
    onSuccess: (r) => patch({ summary: r.summary, takeaways: r.takeaways, quota: r.quota }),
  });

  const chapters = useMutation({
    mutationFn: () => api.generateChapters(id),
    onSuccess: (r) => patch({ chapters: r.chapters, quota: r.quota }),
  });

  const isCurrent = state.current?.id === id;

  /** Take me to where that was said — shared by chapters and by citations. */
  const goTo = (ms: number) => {
    const target = seekTargetSec({ index: 0, startMs: ms, endMs: ms, text: '', speaker: null });

    if (isCurrent) {
      playerActions.seek(target);
      return;
    }

    if (!episode) return;

    void playerActions
      .play(
        playableFromEpisode(episode, {
          title: podcastData?.podcast.title ?? '',
          artworkUrl: podcastData?.podcast.artworkUrl ?? null,
          accentColor: podcastData?.podcast.accentColor ?? null,
        }),
      )
      .then(() => playerActions.seek(target));
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space[2] }]}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={space[3]}
        style={styles.back}
      >
        <View style={styles.backIcon}>
          <Icon path={icon.chevronDown} size={26} color={theme.textSecondary} />
        </View>
      </Pressable>

      <View style={styles.headerText}>
        <Text style={[type('overline'), { color: theme.textTertiary }]}>ABOUT THIS EPISODE</Text>
        {episode ? (
          <Text numberOfLines={1} style={[type('bodyStrong'), { color: theme.textPrimary }]}>
            {episode.title}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (isPending) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg }]}>
        {header}
        <ScreenMessage title="Loading…" />
      </View>
    );
  }

  // Signed out is the common case, not an error — every call here spends an
  // allowance, and an allowance needs somebody to belong to.
  if (error || !data) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg }]}>
        {header}
        <ScreenMessage
          title="Sign in to use this"
          body="Summaries, chapters and questions are tied to your account’s daily allowance."
          action={<Button label="Sign in" onPress={() => router.push('/signin')} />}
        />
      </View>
    );
  }

  const { summary, takeaways, chapters: chapterList, transcript, quota } = data;
  const spent = !quota.byok && quota.remaining === 0;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      {header}

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space[5],
          paddingBottom: insets.bottom + space[10] + (state.current ? MINI_PLAYER_CLEARANCE : 0),
        }}
      >
        <Text style={[type('caption'), { color: theme.textTertiary, marginBottom: space[6] }]}>
          {quota.byok
            ? `Using your own Groq key (…${quota.hint}). No limit from us.`
            : !quota.operatorAvailable
              ? 'Add a Groq API key in Settings to use these.'
              : quota.remaining === 0
                ? 'You’ve used today’s AI requests. Add your own key in Settings for unlimited use.'
                : `${quota.remaining} of ${quota.limit} AI requests left today.`}
        </Text>

        {!transcript.present ? (
          <Block title="No transcript yet">
            <Body>
              {transcribing
                ? 'Listening to the episode and writing it down. This takes a couple of minutes — you can leave this screen.'
                : 'This publisher didn’t provide one. Generating a transcript unlocks the summary, chapters and questions.'}
            </Body>

            {transcribing ? (
              <Text
                accessibilityLiveRegion="polite"
                style={[type('caption'), { color: theme.accentText, marginTop: space[3] }]}
              >
                Transcribing…
              </Text>
            ) : (
              <>
                <Button
                  label="Generate a transcript"
                  onPress={() => transcribe.mutate()}
                  disabled={transcribe.isPending || spent}
                  style={styles.action}
                />
                <Failure error={transcribe.error} />
              </>
            )}
          </Block>
        ) : null}

        {transcript.present ? (
          <>
            <Block title="Summary">
              {summary ? (
                <>
                  <Body>{summary}</Body>
                  {takeaways?.map((item) => (
                    <View key={item} style={styles.bullet}>
                      <Text style={[type('callout'), { color: theme.accentText }]}>—</Text>
                      <Text style={[type('callout'), styles.bulletText, { color: theme.textSecondary }]}>
                        {item}
                      </Text>
                    </View>
                  ))}
                </>
              ) : (
                <>
                  <Body>
                    A few sentences on what this episode actually covered, plus the points worth
                    remembering.
                  </Body>
                  <Button
                    label="Summarise this episode"
                    variant="secondary"
                    onPress={() => brief.mutate()}
                    disabled={brief.isPending || spent}
                    style={styles.action}
                  />
                  <Failure error={brief.error} />
                </>
              )}
            </Block>

            <Block title="Chapters">
              {chapterList ? (
                chapterList.map((chapter) => (
                  <Pressable
                    key={chapter.startMs}
                    onPress={() => goTo(chapter.startMs)}
                    accessibilityRole="button"
                    accessibilityLabel={`${chapter.title}, from ${formatTimestamp(chapter.startMs / 1000)}`}
                    style={({ pressed }) => [
                      styles.row,
                      { backgroundColor: pressed ? theme.surfaceHover : 'transparent' },
                    ]}
                  >
                    <Text style={[type('caption'), styles.stamp, { color: theme.textTertiary }]}>
                      {formatTimestamp(chapter.startMs / 1000)}
                    </Text>
                    <Text style={[type('body'), styles.rowText, { color: theme.textSecondary }]}>
                      {chapter.title}
                    </Text>
                  </Pressable>
                ))
              ) : transcript.timed ? (
                <>
                  <Body>Divide the episode into sections you can jump between.</Body>
                  <Button
                    label="Find the chapters"
                    variant="secondary"
                    onPress={() => chapters.mutate()}
                    disabled={chapters.isPending || spent}
                    style={styles.action}
                  />
                  <Failure error={chapters.error} />
                </>
              ) : (
                <Body>
                  Chapters need a transcript with timings. This one is the publisher’s prose, which
                  has none.
                </Body>
              )}
            </Block>

            <Block title="Ask about this episode">
              <Body>
                Answered from the transcript only, with the lines it used. If the episode doesn’t
                cover it, it says so.
              </Body>
              <Ask episodeId={id} disabled={spent} onSeek={goTo} />
            </Block>
          </>
        ) : null}
      </ScrollView>

      <MiniPlayer bottomOffset={0} />
    </View>
  );
}

/**
 * The question box.
 *
 * Streams on Android too — `xhrSse` in the API client is what makes that
 * possible, since React Native's `fetch` has no readable body. Without it this
 * would be a spinner for several seconds on the platform where that wait is
 * least tolerable.
 */
function Ask({
  episodeId,
  disabled,
  onSeek,
}: {
  episodeId: string;
  disabled: boolean;
  onSeek: (ms: number) => void;
}) {
  const theme = useTheme();

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<AskCitation[]>([]);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const abort = useRef<AbortController | null>(null);

  // A screen that unmounts mid-answer must not leave the model writing one
  // nobody will read, billed to whoever asked.
  useEffect(() => () => abort.current?.abort(), []);

  const ask = async () => {
    const trimmed = question.trim();
    if (!trimmed || asking) return;

    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setAsking(true);
    setAnswer('');
    setCitations([]);
    setFailure(null);

    try {
      await api.askEpisode(episodeId, {
        question: trimmed,
        signal: controller.signal,
        onToken: (token) => setAnswer((previous) => previous + token),
        onCitations: setCitations,
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailure(error instanceof Error ? error.message : 'The answer stopped unexpectedly');
      }
    } finally {
      if (abort.current === controller) setAsking(false);
    }
  };

  return (
    <View style={{ marginTop: space[3] }}>
      <TextInput
        value={question}
        onChangeText={setQuestion}
        editable={!disabled}
        maxLength={QUESTION_MAX}
        placeholder="What did they say about…?"
        placeholderTextColor={theme.textTertiary}
        accessibilityLabel="Ask about this episode"
        returnKeyType="send"
        onSubmitEditing={() => void ask()}
        style={[
          type('callout'),
          styles.input,
          {
            color: theme.textPrimary,
            backgroundColor: theme.surface,
            borderColor: theme.border,
          },
        ]}
      />

      <Button
        label={asking ? 'Asking…' : 'Ask'}
        variant="secondary"
        onPress={() => void ask()}
        disabled={disabled || asking || question.trim() === ''}
        style={styles.action}
      />

      {answer ? (
        <View style={{ marginTop: space[4] }}>
          <Text
            accessibilityLiveRegion="polite"
            style={[type('body'), { color: theme.textSecondary }]}
          >
            {answer}
          </Text>

          {citations.length > 0 ? (
            <View style={{ marginTop: space[4] }}>
              <Text style={[type('overline'), { color: theme.textTertiary }]}>
                FROM THE TRANSCRIPT
              </Text>
              {citations.map((citation) => (
                <Pressable
                  key={citation.segmentIndex}
                  onPress={() => onSeek(citation.startMs)}
                  accessibilityRole="button"
                  accessibilityLabel={`Play from ${formatTimestamp(citation.startMs / 1000)}`}
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: pressed ? theme.surfaceHover : 'transparent' },
                  ]}
                >
                  <Text style={[type('caption'), styles.stamp, { color: theme.accentText }]}>
                    {formatTimestamp(citation.startMs / 1000)}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[type('caption'), styles.rowText, { color: theme.textTertiary }]}
                  >
                    {citation.text}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {failure ? (
        <Text
          accessibilityLiveRegion="assertive"
          style={[type('caption'), { color: theme.danger, marginTop: space[3] }]}
        >
          {failure}
        </Text>
      ) : null}
    </View>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();

  return (
    <View style={styles.block}>
      <Text style={[type('title3'), { color: theme.textPrimary, marginBottom: space[2] }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <Text style={[type('body'), { color: theme.textSecondary }]}>{children}</Text>;
}

/**
 * The server's own words.
 *
 * A spent quota, a rejected key and an episode with no transcript are different
 * problems with different fixes, and replacing them with "Something went wrong"
 * throws away the only part the reader can act on.
 */
function Failure({ error }: { error: unknown }) {
  const theme = useTheme();
  if (!error) return null;

  return (
    <Text
      accessibilityLiveRegion="assertive"
      style={[type('caption'), { color: theme.danger, marginTop: space[3] }]}
    >
      {error instanceof Error ? error.message : 'That didn’t work'}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingBottom: space[3],
  },
  back: { padding: space[2] },
  backIcon: { transform: [{ rotate: '90deg' }] },
  headerText: { flex: 1 },
  block: { marginBottom: space[8] },
  action: { marginTop: space[4], alignSelf: 'flex-start' },
  bullet: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  bulletText: { flex: 1 },
  row: {
    flexDirection: 'row',
    gap: space[3],
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
  },
  stamp: { width: 46, textAlign: 'right', paddingTop: 2 },
  rowText: { flex: 1 },
  input: {
    minHeight: 44,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
