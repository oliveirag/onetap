import { Stack } from 'expo-router';

import { AnswersProvider } from '@/components/onboarding/AnswersProvider';
import { useTheme } from '@/theme/ThemeProvider';

export const unstable_settings = { initialRouteName: 'welcome' };

// Signed out: the questionnaire, then the account. Native push transitions and swipe-back.
export default function AuthLayout() {
  const { theme } = useTheme();
  return (
    <AnswersProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.surface.page } }}>
        <Stack.Screen name="welcome" />
        {/* The pause is a one-way door: no swipe back into it, and it replaces itself with the plan. */}
        <Stack.Screen name="building" options={{ gestureEnabled: false, animation: 'fade' }} />
      </Stack>
    </AnswersProvider>
  );
}
