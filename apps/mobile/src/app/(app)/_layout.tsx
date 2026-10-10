import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useMe } from '@/lib/queries';
import { useTheme } from '@/lib/theme';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function AppLayout() {
  const { colors, setPreference } = useTheme();
  const me = useMe();
  useEffect(() => {
    if (me.data?.themePreference) setPreference(me.data.themePreference);
  }, [me.data?.themePreference, setPreference]);

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="reclaimed-card" options={{ title: 'Reclaimed Card' }} />
      <Stack.Screen name="enroll" options={{ title: 'Enroll test card', presentation: 'modal' }} />
      <Stack.Screen name="funding" options={{ title: 'Mock funding accounts' }} />
      <Stack.Screen name="connect-bank" options={{ title: 'Connect a bank', presentation: 'modal' }} />
      <Stack.Screen name="card-products" options={{ title: 'Card products' }} />
      <Stack.Screen name="accounts/[id]" options={{ title: 'Card details' }} />
      <Stack.Screen name="accounts/product/[id]" options={{ title: 'Confirm card product' }} />
      <Stack.Screen name="pay/[accountId]" options={{ title: 'Pay card', presentation: 'modal' }} />
      <Stack.Screen name="bill-payments/[id]" options={{ title: 'Test payment' }} />
      <Stack.Screen name="transactions/[id]" options={{ title: 'Simulated transaction' }} />
      <Stack.Screen name="dev-hardware" options={{ title: 'Developer hardware' }} />
    </Stack>
  );
}
