import { router } from 'expo-router';
import { useState } from 'react';

import { useAnswers } from '@/components/onboarding/AnswersProvider';
import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { SwipeDeck } from '@/components/onboarding/SwipeDeck';
import { Text } from '@/components/ui/Text';
import { progressOf, STATEMENTS } from '@/lib/onboarding';

// Swipe right if it sounds like you. Interactive self-identification, in the user's own words.
export default function Relate() {
  const { update } = useAnswers();
  const [picks, setPicks] = useState<boolean[]>([]);

  const answer = (agree: boolean) => {
    const next = [...picks, agree];
    setPicks(next);
    if (next.length === STATEMENTS.length) {
      update({ relate: next });
      router.push('/solution');
    }
  };

  return (
    <FlowScreen
      title="Sound familiar?"
      subtitle="Swipe right if it sounds like you, left if it doesn't."
      progress={progressOf('relate')}
    >
      <SwipeDeck statements={STATEMENTS} index={Math.min(picks.length, STATEMENTS.length - 1)} onAnswer={answer} />
      <Text variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
        {Math.min(picks.length + 1, STATEMENTS.length)} of {STATEMENTS.length}
      </Text>
    </FlowScreen>
  );
}
