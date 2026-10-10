import { router } from 'expo-router';
import { View } from 'react-native';

import { useAnswers } from '@/components/onboarding/AnswersProvider';
import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { fixesFor, progressOf, STATEMENTS } from '@/lib/onboarding';
import { useTheme } from '@/theme/ThemeProvider';

// The bridge: their own words back to them (quiet), each with the fix (strong).
export default function Solution() {
  const { theme } = useTheme();
  const { answers } = useAnswers();
  const agreed = answers.relate.filter(Boolean).length;
  const subtitle =
    agreed > 0 ? `You said "me too" to ${agreed} of ${STATEMENTS.length}. Here's how OneTap takes care of it.` : "Here's how OneTap takes care of it.";

  return (
    <FlowScreen
      title="You don't have to think about it"
      subtitle={subtitle}
      progress={progressOf('solution')}
      footer={<Button label="Add my cards" onPress={() => router.push('/wallet')} />}
    >
      <View style={{ gap: theme.space.lg }}>
        {fixesFor(answers.pains).map((p) => (
          <View key={p.id} style={{ flexDirection: 'row', gap: theme.space.md }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: theme.radius.full,
                backgroundColor: theme.color.surface.action,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={p.icon} size={18} tone="on-action" />
            </View>
            <View style={{ flex: 1, gap: theme.space.xs }}>
              <Text variant="body-sm" tone="tertiary">
                {p.label}
              </Text>
              <Text style={{ fontFamily: 'JBMono-Medium' }}>{p.fix}</Text>
            </View>
          </View>
        ))}
      </View>
    </FlowScreen>
  );
}
