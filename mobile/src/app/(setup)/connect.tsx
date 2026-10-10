import { router } from 'expo-router';
import { View } from 'react-native';

import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { FormError } from '@/components/onboarding/FormError';
import { CardArt } from '@/components/onetap/CardArt';
import { Button } from '@/components/ui/Button';
import { DemoLabel } from '@/components/ui/DemoLabel';
import { Money } from '@/components/ui/Money';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/lib/auth';
import { useConnectTestAccounts } from '@/lib/queries';
import { setupProgress } from '@/lib/setup';
import { useTheme } from '@/theme/ThemeProvider';

// Step 1 of 4: connect cards. Until the backend's Plaid endpoints are on main this uses the
// PRD F2 fallback (sandbox test accounts) and lists every account returned.
export default function Connect() {
  const { theme } = useTheme();
  const { session, setStep } = useAuth();
  const connect = useConnectTestAccounts();
  const first = session?.fullName?.split(' ')[0];

  const next = async () => {
    await setStep('match');
    router.replace('/match');
  };

  return (
    <FlowScreen
      title={first ? `Welcome, ${first}. Connect your cards` : 'Connect your cards'}
      subtitle="We read card names, balances and limits. We never move money."
      progress={setupProgress('connect')}
      back={false}
      footer={
        <>
          <FormError text={connect.error ? "Your cards didn't connect. Check your connection and try again." : null} />
          {connect.data ? (
            <Button label="Continue" onPress={next} />
          ) : (
            <Button label="Connect cards" loading={connect.isPending} onPress={() => connect.mutate()} />
          )}
        </>
      }
    >
      {connect.data ? (
        <View style={{ gap: theme.space.sm }}>
          <Text variant="h4" accessibilityRole="header">
            {connect.data.length} cards found
          </Text>
          {connect.data.map((c) => (
            <View
              key={c.id}
              accessible
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.md,
                padding: theme.space.md,
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.color.border.default,
                backgroundColor: theme.color.surface.default,
              }}
            >
              <CardArt art={c.card_product?.card_art ?? 'solid'} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontFamily: 'JBMono-Medium' }}>
                  {c.account_name}
                </Text>
                <Text variant="body-sm" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                  •••• {c.mask}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Money cents={c.current_balance_cents} variant="body-sm" />
                <Text variant="caption" tone="tertiary">
                  of <Money cents={c.credit_limit_cents} variant="caption" tone="tertiary" />
                </Text>
              </View>
            </View>
          ))}
          <DemoLabel text="Plaid sandbox test accounts" />
        </View>
      ) : null}
    </FlowScreen>
  );
}
