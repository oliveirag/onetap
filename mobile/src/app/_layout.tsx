import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { TransactionListener } from '@/components/TransactionListener';
import { queryClient } from '@/lib/queries';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'JBMono-Regular': require('../../assets/fonts/JetBrainsMonoNL-Regular.ttf'),
    'JBMono-Medium': require('../../assets/fonts/JetBrainsMonoNL-Medium.ttf'),
    'JBMono-Bold': require('../../assets/fonts/JetBrainsMonoNL-Bold.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <Root />
        </QueryClientProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  const { theme, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {/* userId arrives with sign-in (Task 7); in mock mode the listener runs without one. */}
      <TransactionListener userId={null} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.surface.page } }}>
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
      </Stack>
    </>
  );
}
