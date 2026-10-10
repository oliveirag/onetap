import { Stack } from 'expo-router';
import { useTheme } from '@/lib/theme';

export const unstable_settings = { initialRouteName: 'sign-in' };

export default function AuthLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShadowVisible: false, headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, headerTitle: '', contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
    </Stack>
  );
}
