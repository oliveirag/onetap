import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

// Only shown when the Supabase project has "Confirm email" on: the account exists but has no
// session until the link is opened. Opening it confirms the email; then they log in here.
export default function CheckEmail() {
  const { theme } = useTheme();
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  return (
    <FlowScreen
      title="Check your email"
      onBack={() => router.replace('/welcome')}
      footer={<Button label="Log in" onPress={() => router.replace({ pathname: '/login', params: { email } })} />}
    >
      <View style={{ flexDirection: 'row', gap: theme.space.md }}>
        <Icon name="mail" size={20} />
        <View style={{ flex: 1, gap: theme.space.xs }}>
          <Text tone="secondary">We sent a confirmation link to</Text>
          <Text style={{ fontFamily: 'JBMono-Medium' }}>{email}</Text>
        </View>
      </View>
      <Text tone="secondary">Open the link, then come back and log in. Your plan is saved on your account.</Text>
    </FlowScreen>
  );
}
