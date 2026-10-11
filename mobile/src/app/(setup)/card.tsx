import { View } from 'react-native';

import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { FormError } from '@/components/onboarding/FormError';
import { Hint } from '@/components/onboarding/Hint';
import { OneTapCard } from '@/components/onetap/OneTapCard';
import { Button } from '@/components/ui/Button';
import { Enter } from '@/components/ui/Enter';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { apiMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCreateOneTapCard, useProfile, useUserCards } from '@/lib/queries';
import { backFrom, setupProgress } from '@/lib/setup';
import { useTheme } from '@/theme/ThemeProvider';

const perks = (manualName?: string): { icon: IconName; title: string; body: string }[] => [
  { icon: 'tap', title: 'Tap it at the store', body: 'Use it at the terminal like any other card.' },
  manualName
    ? { icon: 'cards', title: `Always ${manualName}`, body: 'Every purchase goes to the card you picked. Switch to Auto from Home.' }
    : { icon: 'auto', title: 'The best card, automatically', body: 'Each purchase goes to the card that earns the most.' },
  { icon: 'chart', title: 'See every decision', body: 'Your phone shows where it went and why.' },
];

// Step 4 of 4, after Venmo's debit card screen: the card, three short promises, one action.
// Creating it is the backend's Lithic call; the reveal is a rare first-time moment, so it animates.
export default function Card() {
  const { theme } = useTheme();
  const { setStep } = useAuth();
  const create = useCreateOneTapCard();
  const profile = useProfile();
  const cards = useUserCards();
  const card = create.data;
  // Printed on the face like Home does, so the mode they just chose shows up here.
  const manual = profile.data?.routing_mode === 'manual';
  const manualCard = cards.data?.find((c) => c.id === profile.data?.manual_card_id);
  const manualName = manual && manualCard ? (manualCard.card_product?.name ?? manualCard.account_name) : undefined;
  const status = manual ? (manualName ? `Always ${manualName}` : undefined) : 'Best card, automatically';

  return (
    <FlowScreen
      title={card ? 'Your OneTap card is ready' : 'Meet your OneTap card'}
      subtitle={card ? 'Tap this card at the store. Your phone shows where the purchase went.' : 'One card that stands in for all of yours.'}
      progress={setupProgress('card')}
      onBack={() => backFrom('card')}
      footer={
        <>
          <FormError text={create.error ? (apiMessage(create.error) ?? "Your card wasn't created. Check your connection and try again.") : null} />
          {/* Linking waits for the physical card to be tapped on the store reader. */}
          <Hint text={create.isPending ? 'Hold your OneTap card on the reader.' : null} />
          {card ? (
            // Writing 'done' flips the root gate: setup unmounts and Home appears.
            <Button label="Go to home" onPress={() => setStep('done')} />
          ) : (
            <Button label="Create my card" loading={create.isPending} onPress={() => create.mutate()} />
          )}
        </>
      }
    >
      <View>
        {card ? (
          <Enter>
            <OneTapCard last4={card.last4} status={status} auto={!manual} />
          </Enter>
        ) : create.isPending ? (
          <Skeleton aspectRatio={1.6} radius={theme.radius.xl} />
        ) : (
          <OneTapCard last4="••••" />
        )}
      </View>

      <View style={{ gap: theme.space.lg }}>
        {perks(manualName).map((p) => (
          <View key={p.title} style={{ flexDirection: 'row', gap: theme.space.md, alignItems: 'center' }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: theme.radius.full,
                backgroundColor: theme.color.surface.action,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={p.icon} size={18} tone="on-action" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'JBMono-Medium' }}>{p.title}</Text>
              <Text variant="body-sm" tone="secondary">
                {p.body}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </FlowScreen>
  );
}
