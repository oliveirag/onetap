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

// The cards in their wallet, so the plan routes between cards they actually own. The real accounts
// connect with Plaid after sign-up; skipping prices the plan on a labeled sample of popular cards.
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
      title="Which cards do you carry?"
      subtitle="You'll connect them after sign-up."
      progress={progressOf('wallet')}
      footer={
        n ? (
          <Button label={`Continue with ${n} card${n === 1 ? '' : 's'}`} onPress={() => router.push('/spend')} />
        ) : (
          <>
            <Hint text={hint} />
            <Button label="Continue" ready={false} onPress={() => setHint('Pick a card, or use sample cards.')} />
            <Button variant="ghost" label="Use sample cards" onPress={() => router.push('/spend')} />
          </>
        )
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
