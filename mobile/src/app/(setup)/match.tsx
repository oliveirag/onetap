import { router } from 'expo-router';
import { View } from 'react-native';

import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { CardArt } from '@/components/onetap/CardArt';
import { Button } from '@/components/ui/Button';
import { DemoLabel } from '@/components/ui/DemoLabel';
import { Icon } from '@/components/ui/Icon';
import { PressableScale } from '@/components/ui/PressableScale';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/lib/auth';
import { useUserCards } from '@/lib/queries';
import { backFrom, setupProgress } from '@/lib/setup';
import { useTheme } from '@/theme/ThemeProvider';

// Step 2 of 4: confirm matches. Each account arrives pre-matched by name; an account with no
// match is "Other card (1x on everything)" so routing still works. Tap a row to change it.
export default function Match() {
  const { theme } = useTheme();
  const { setStep } = useAuth();
  const cards = useUserCards();

  const next = async () => {
    await setStep('mode');
    router.push('/mode');
  };

  return (
    <FlowScreen
      title="Are these your cards?"
      subtitle="Tap one to fix a wrong match."
      progress={setupProgress('match')}
      onBack={() => backFrom('match')}
      footer={<Button label="Looks right" onPress={next} />}
    >
      {cards.isLoading ? (
        <View style={{ gap: theme.space.sm }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={72} radius={theme.radius.lg} />
          ))}
        </View>
      ) : cards.error || !cards.data ? (
        <ErrorState what="Your cards didn't load." todo="Check your connection and try again." onRetry={() => cards.refetch()} />
      ) : (
        <View style={{ gap: theme.space.sm }}>
          {cards.data.map((c) => {
            const product = c.card_product;
            const matched = product && !product.is_generic;
            return (
              <PressableScale
                key={c.id}
                hitSlop={0}
                accessibilityRole="button"
                accessibilityLabel={`${c.account_name} ending ${c.mask}, ${matched ? `matched to ${product.name}` : 'other card, 1x on everything'}. Change match`}
                onPress={() => router.push({ pathname: '/match-pick', params: { cardId: c.id } })}
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
                <CardArt art={product?.card_art ?? 'solid'} />
                <View style={{ flex: 1, gap: theme.space.xs }}>
                  <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
                    <Text numberOfLines={1} variant="body-sm" tone="secondary" style={{ flexShrink: 1 }}>
                      {c.account_name}
                    </Text>
                    <Text variant="body-sm" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                      •••• {c.mask}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: theme.font.medium }}>
                    {matched ? `Matched to ${product.name}` : 'Other card (1x on everything)'}
                  </Text>
                </View>
                <Icon name="chevron-right" tone="tertiary" />
              </PressableScale>
            );
          })}
          <DemoLabel text="Point values are estimates" />
        </View>
      )}
    </FlowScreen>
  );
}
