import { icon } from '@cue/design';
import { Tabs } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icon';
import { MiniPlayer } from '@/components/mini-player';
import { hydrateQueue, setSyncState } from '@/lib/player/store';
import { useSession } from '@/lib/session';
import { TAB_BAR_HEIGHT, type, useTheme } from '@/theme';

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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
