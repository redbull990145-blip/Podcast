import { icon } from '@cue/design';
import { Tabs } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icon';
import { MiniPlayer } from '@/components/mini-player';
import { OfflineBanner } from '@/components/offline-banner';
import { hydrateQueue, setSyncState, usePlayerState } from '@/lib/player/store';
import { useSession } from '@/lib/session';
import { flushProgress } from '@/lib/sync/outbox';
import { MINI_PLAYER_HEIGHT, TAB_BAR_HEIGHT, type, useTheme } from '@/theme';

/**
 * The tab shell.
 *
 * Three destinations, deliberately. A media app earns its speed partly by
 * having few places to be: every extra tab is a decision the listener makes
 * before they can hear anything.
 *
 * The mini player is a sibling of the navigator rather than a screen inside
 * it, so it stays put while tabs change underneath — and, more importantly,
 * never unmounts.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  /**
   * Tell the player whether there is an account behind it.
   *
   * In the shell rather than on the queue screen for both halves: what is
   * queued decides what plays when the current episode ends, and whether
   * progress is worth reporting applies everywhere — neither can wait for
   * someone to open a particular screen.
   *
   * The player is a singleton outside React and cannot read the session
   * itself, so this is the one place that pushes it down.
   */
  const { isSignedIn, isLoading } = useSession();
  const playing = usePlayerState().current !== null;

  useEffect(() => {
    // Stay `unknown` until the answer is real. Reporting "anonymous" while the
    // request is in flight would suppress the resume lookup for someone who is
    // in fact signed in and simply pressed play quickly.
    if (isLoading) return;
    setSyncState(isSignedIn ? 'authenticated' : 'anonymous');
  }, [isSignedIn, isLoading]);

  useEffect(() => {
    if (!isSignedIn) return;
    void hydrateQueue();
  }, [isSignedIn]);

  /**
   * Deliver anything held from a session spent offline.
   *
   * The outbox drains itself when the connection *changes*, which covers losing
   * signal and getting it back inside one session. It does not cover the other
   * shape: listen on a plane, close the app, land, reopen. Nothing changes on
   * that launch — the phone simply has signal — so the flush has to be asked
   * for once, here, where we also first learn there is an account to send to.
   */
  useEffect(() => {
    if (!isSignedIn) return;
    void flushProgress();
  }, [isSignedIn]);

  return (
    <View style={styles.root}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.accentText,
          tabBarInactiveTintColor: theme.textTertiary,
          tabBarStyle: {
            backgroundColor: theme.surface,
            borderTopColor: theme.border,
            borderTopWidth: StyleSheet.hairlineWidth,
            // In dark mode depth comes from surface lightness, not shadow —
            // a shadow on near-black is invisible and only costs paint time.
            elevation: 0,
            height: TAB_BAR_HEIGHT + insets.bottom,
            paddingBottom: insets.bottom,
          },
          tabBarLabelStyle: {
            fontSize: type('overline').fontSize,
            letterSpacing: type('overline').letterSpacing,
            fontWeight: type('caption').fontWeight,
          },
          sceneStyle: { backgroundColor: theme.bg },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Listen',
            tabBarIcon: ({ color, focused }) => (
              <Icon path={icon.home} color={color} filled={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: 'Search',
            tabBarIcon: ({ color }) => (
              // Never filled: a filled magnifier is a blob at 22px.
              <Icon path={icon.search} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: 'Library',
            tabBarIcon: ({ color, focused }) => (
              <Icon path={icon.library} color={color} filled={focused} />
            ),
          }}
        />
      </Tabs>

      <MiniPlayer />

      {/* Above the mini player rather than at the top of the screen: each tab
          owns its own top inset, and a strip that appeared up there would push
          three different layouts around. Down here it joins the chrome that is
          already persistent, and is visible on every tab for the same reason
          the mini player is. */}
      <OfflineBanner
        bottom={TAB_BAR_HEIGHT + insets.bottom + (playing ? MINI_PLAYER_HEIGHT + 8 : 0)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
