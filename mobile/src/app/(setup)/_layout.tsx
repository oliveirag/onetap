import { Stack } from 'expo-router';

import { useAuth } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';

// Signed in, setup unfinished (PRD F2): connect, match, mode, card. Opens on the saved step, so
// killing the app mid-setup resumes there.
export default function SetupLayout() {
  const { theme } = useTheme();
  const { session } = useAuth();
  const initial = session && session.step !== 'done' ? session.step : 'connect';
  return (
    <Stack initialRouteName={initial} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.surface.page } }}>
      <Stack.Screen name="connect" />
      <Stack.Screen name="match" />
      <Stack.Screen name="mode" />
      <Stack.Screen name="card" />
      <Stack.Screen
        name="match-pick"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.75, 1],
          sheetGrabberVisible: true,
          sheetCornerRadius: 16,
          contentStyle: { backgroundColor: theme.color.surface.raised },
        }}
      />
    </Stack>
  );
}
