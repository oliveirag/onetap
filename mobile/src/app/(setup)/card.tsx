import { View } from 'react-native';

import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { FormError } from '@/components/onboarding/FormError';
import { CARD_RATIO, OneTapCard } from '@/components/onetap/OneTapCard';
import { TapFeedArt } from '@/components/onetap/TapFeedArt';
import { Button } from '@/components/ui/Button';
import { ConfirmMorph } from '@/components/ui/ConfirmMorph';
import { Enter } from '@/components/ui/Enter';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { apiMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCreateOneTapCard, useProfile, useUserCards } from '@/lib/queries';
import { backFrom, setupProgress } from '@/lib/setup';
import { duration } from '@/theme/motion';
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
          {card ? (
            // Writing 'done' flips the root gate: setup unmounts and Home appears.
            <Button label="Go to home" onPress={() => setStep('done')} />
          ) : (
            // Confirm in place, after Revolut: the button becomes the question, no alert.
            <ConfirmMorph
              block
              variant="primary"
              confirmTone="primary"
              label="Create my card"
              prompt="Create your OneTap card? It goes live right away as a digital card."
              confirmLabel="Create card"
              pendingLabel="Creating your card"
              doneLabel="Card created"
              errorLabel="Your card was not created."
              onConfirm={() => create.mutateAsync()}
            />
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
          <Skeleton aspectRatio={CARD_RATIO} radius={theme.radius.xl} />
        ) : (
          <OneTapCard last4="••••" />
        )}
      </View>

      {card ? (
        // After Revolut's notification pre-prompt: what happens next, drawn, once the card exists.
        <Enter kind="fade" delay={duration.stagger * 2} style={{ gap: theme.space.lg, alignItems: 'center', paddingTop: theme.space.lg }}>
          <TapFeedArt />
          <View style={{ gap: theme.space.xs, alignItems: 'center' }}>
            <Text variant="h3" style={{ textAlign: 'center' }}>
              Every tap shows up here
            </Text>
            <Text tone="secondary" style={{ textAlign: 'center' }}>
              Tap at the store and this phone buzzes with the receipt: the card it went to and what you earned.
            </Text>
          </View>
        </Enter>
      ) : (
        // The card lands first, then the details.
        <Enter kind="fade" delay={duration.stagger}>
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
        </Enter>
      )}
    </FlowScreen>
  );
}
