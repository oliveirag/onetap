import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useAnswers } from '@/components/onboarding/AnswersProvider';
import { Choice } from '@/components/onboarding/Choice';
import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { Hint } from '@/components/onboarding/Hint';
import { Button } from '@/components/ui/Button';
import { GOALS, progressOf } from '@/lib/onboarding';
import { useTheme } from '@/theme/ThemeProvider';

// Goal: one pick. Saying what they want first makes the rest of the flow about them.
export default function Goal() {
  const { theme } = useTheme();
  const { answers, update } = useAnswers();
  const [hint, setHint] = useState<string | null>(null);

  return (
    <FlowScreen
      title="What do you want from your cards?"
      subtitle="Pick the one that sounds most like you."
      progress={progressOf('goal')}
      footer={
        <>
          <Hint text={hint} />
          <Button label="Continue" ready={!!answers.goal} onPress={() => (answers.goal ? router.push('/pains') : setHint('Pick one to continue.'))} />
        </>
      }
    >
      <View accessibilityRole="radiogroup" accessibilityLabel="Your goal" style={{ gap: theme.space.sm }}>
        {GOALS.map((g) => (
          <Choice
            key={g.id}
            label={g.label}
            icon={g.icon}
            selected={answers.goal === g.id}
            onPress={() => {
              update({ goal: g.id });
              setHint(null);
            }}
          />
        ))}
      </View>
    </FlowScreen>
  );
}
