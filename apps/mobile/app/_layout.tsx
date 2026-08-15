import { ApiClientError } from '@cue/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LocaleProvider } from '@/lib/i18n';
import { useTheme } from '@/theme';

/**
 * Root layout.
 *
 * `GestureHandlerRootView` has to wrap the entire tree or no gesture anywhere
 * in the app is recognised — and it fails silently, which makes it a
 * memorable afternoon to debug.
 */
export default function RootLayout() {
  const theme = useTheme();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 30 * 60_000,
            // Mobile networks drop constantly; reconnecting is a real signal
            // that cached data may be stale, unlike a window regaining focus.
            refetchOnReconnect: true,
            retry: (failureCount, error) =>
              error instanceof ApiClientError
                ? error.retryable && failureCount < 2
                : failureCount < 2,
          },
        },
      }),
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <LocaleProvider>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.bg },
              // Platform-appropriate: this is Android's own screen transition,
              // not a re-creation of the web app's motion.
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="podcast/[id]" />
            <Stack.Screen name="episode/[id]" />
            <Stack.Screen name="transcript/[id]" />
            <Stack.Screen name="ai/[id]" />
            {/*
              Now Playing rises from the bottom, the way a thing you summoned
              rather than navigated to should. It is the one screen in the app
              that is a place you are in rather than a page you went to.
            */}
            <Stack.Screen
              name="player"
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="queue"
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="downloads"
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
            <Stack.Screen name="signin" options={{ presentation: 'modal' }} />
          </Stack>
          </LocaleProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
