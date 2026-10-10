import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useAnswers } from '@/components/onboarding/AnswersProvider';
import { Choice } from '@/components/onboarding/Choice';
import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { Hint } from '@/components/onboarding/Hint';
import { CardArt } from '@/components/onetap/CardArt';
import { Button } from '@/components/ui/Button';
import { catalogChoices, progressOf } from '@/lib/onboarding';
import { useTheme } from '@/theme/ThemeProvider';

// Which cards are in their wallet. Feeds the demo; the real accounts come from Plaid after sign-up.
export default function Wallet() {
  const { theme } = useTheme();
  const { answers, update } = useAnswers();
  const [hint, setHint] = useState<string | null>(null);
  const toggle = (id: string) => {
    setHint(null);
    update({ wallet: answers.wallet.includes(id) ? answers.wallet.filter((w) => w !== id) : [...answers.wallet, id] });
  };
  const n = answers.wallet.length;

  return (
    <FlowScreen
      title="Which cards do you have?"
      subtitle="Pick every credit card you carry. You can connect the real accounts later."
      progress={progressOf('wallet')}
      footer={
        <>
          <Hint text={hint} />
          <Button
            label={n ? `Continue with ${n} card${n === 1 ? '' : 's'}` : 'Continue'}
            onPress={() => (n ? router.push('/spend') : setHint('Pick at least one card, or try a sample wallet.'))}
          />
          {n === 0 ? <Button variant="ghost" label="Try a sample wallet" onPress={() => router.push('/spend')} /> : null}
        </>
      }
    >
      <View accessibilityLabel="Your cards" style={{ gap: theme.space.sm }}>
        {catalogChoices.map((c) => (
          <Choice
            key={c.id}
            multi
            label={c.name}
            description={c.issuer}
            leading={<CardArt art={c.art} />}
            selected={answers.wallet.includes(c.id)}
            onPress={() => toggle(c.id)}
          />
        ))}
      </View>
    </FlowScreen>
  );
}
