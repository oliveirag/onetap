import { router } from 'expo-router';
import { View } from 'react-native';

import { useAnswers } from '@/components/onboarding/AnswersProvider';
import { Choice } from '@/components/onboarding/Choice';
import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { Button } from '@/components/ui/Button';
import { PAINS, progressOf, type PainId } from '@/lib/onboarding';
import { useTheme } from '@/theme/ThemeProvider';

// Pain points: pick any. These come back on the plan as the things OneTap fixes.
export default function Pains() {
  const { theme } = useTheme();
  const { answers, update } = useAnswers();
  const toggle = (id: PainId) =>
    update({ pains: answers.pains.includes(id) ? answers.pains.filter((p) => p !== id) : [...answers.pains, id] });

  return (
    <FlowScreen
      title="What gets in the way?"
      subtitle="Pick all that apply."
      progress={progressOf('pains')}
      footer={<Button label="Continue" onPress={() => router.push('/wallet')} />}
    >
      <View accessibilityLabel="What gets in the way" style={{ gap: theme.space.sm }}>
        {PAINS.map((p) => (
          <Choice key={p.id} multi label={p.label} selected={answers.pains.includes(p.id)} onPress={() => toggle(p.id)} />
        ))}
      </View>
    </FlowScreen>
  );
}
