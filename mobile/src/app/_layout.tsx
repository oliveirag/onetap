import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { OfflineBanner } from '@/components/OfflineBanner';
import { TransactionListener } from '@/components/TransactionListener';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/queries';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    // Geist for every UI weight, and SemiBold for the One Tap wordmark.
    'Geist-Regular': require('../../assets/fonts/Geist-Regular.ttf'),
    'Geist-Medium': require('../../assets/fonts/Geist-Medium.ttf'),
    'Geist-SemiBold': require('../../assets/fonts/Geist-SemiBold.ttf'),
    'Geist-Bold': require('../../assets/fonts/Geist-Bold.ttf'),
  });

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Root />
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

// The gate (PRD F1, F2): signed out sees Welcome, signed in with setup unfinished resumes setup,
// everyone else gets the tabs. Protected screens redirect on their own when the session changes.
function Root() {
  const { theme, scheme } = useTheme();
  const { ready, session } = useAuth();
  const done = !!session && session.step === 'done';

  // Keep the splash up until we know which side of the gate to show, so nothing flashes.
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {session && done ? <TransactionListener userId={session.userId} /> : null}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.surface.page } }}>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={!!session && !done}>
          <Stack.Screen name="(setup)" />
        </Stack.Protected>
        <Stack.Protected guard={done}>
          <Stack.Screen name="(tabs)" />
          {/* Native iOS sheet: 1:1 drag, velocity handoff and rubber-banding come from the system. */}
          <Stack.Screen
            name="result/[id]"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [0.75, 1],
              sheetGrabberVisible: true,
              sheetCornerRadius: 16,
              contentStyle: { backgroundColor: theme.color.surface.raised },
            }}
          />
        </Stack.Protected>
      </Stack>
      <OfflineBanner />
    </>
  );
}
