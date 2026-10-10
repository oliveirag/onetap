import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Choice } from '@/components/onboarding/Choice';
import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { Hint } from '@/components/onboarding/Hint';
import { CardArt } from '@/components/onetap/CardArt';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { useProfile, useSetManualCard, useSetMode, useUserCards } from '@/lib/queries';
import { backFrom, setupProgress } from '@/lib/setup';
import { useTheme } from '@/theme/ThemeProvider';

// Step 3 of 4: Auto or Manual, Venmo-privacy style cards in one labeled group. Manual also picks
// the card. Same profile writes as the Home toggle, so the two never disagree.
export default function Mode() {
  const { theme } = useTheme();
  const { setStep } = useAuth();
  const profile = useProfile();
  const cards = useUserCards();
  const setMode = useSetMode();
  const setManualCard = useSetManualCard();
  const [hint, setHint] = useState<string | null>(null);
  const mode = profile.data?.routing_mode ?? 'auto';
  const usable = (cards.data ?? []).filter((c) => c.is_active);

  const choose = (m: 'auto' | 'manual') => {
    if (m === mode) return;
    haptics.select();
    setHint(null);
    setMode.mutate(m);
  };

  const next = async () => {
    if (mode === 'manual' && !usable.some((c) => c.id === profile.data?.manual_card_id)) {
      setHint('Pick the card Manual mode should use.');
      return;
    }
    await setStep('card');
    router.push('/card');
  };

  return (
    <FlowScreen
      title="How should OneTap pick?"
      subtitle="You can switch any time from Home."
      progress={setupProgress('mode')}
      onBack={() => backFrom('mode')}
      footer={
        <>
          <Hint text={hint} />
          <Button label="Continue" onPress={next} />
        </>
      }
    >
      <View accessibilityRole="radiogroup" accessibilityLabel="Routing mode" style={{ gap: theme.space.sm }}>
        <Choice
          icon="auto"
          label="Auto"
          description="We pick the card that earns the most on each purchase."
          selected={mode === 'auto'}
          onPress={() => choose('auto')}
        />
        <Choice icon="cards" label="Manual" description="One card for everything. You choose which." selected={mode === 'manual'} onPress={() => choose('manual')} />
      </View>

      {mode === 'manual' ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Card for every purchase" style={{ gap: theme.space.sm }}>
          <Text variant="h4" accessibilityRole="header">
            Use this card for everything
          </Text>
          {usable.map((c) => (
            <Choice
              key={c.id}
              label={c.card_product?.name ?? c.account_name}
              description={`•••• ${c.mask}`}
              leading={<CardArt art={c.card_product?.card_art ?? 'solid'} />}
              selected={profile.data?.manual_card_id === c.id}
              onPress={() => {
                setHint(null);
                setManualCard.mutate(c.id);
              }}
            />
          ))}
        </View>
      ) : null}
    </FlowScreen>
  );
}
