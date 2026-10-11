import { router } from 'expo-router';
import { View } from 'react-native';

import { useAnswers } from '@/components/onboarding/AnswersProvider';
import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

const WHAT_YOU_GET: { icon: IconName; text: string }[] = [
  { icon: 'cards', text: 'Pick the cards you carry' },
  { icon: 'chart', text: 'See which card wins each category' },
  { icon: 'arrow-up', text: "See what you'd earn" },
];

// The fork: the questionnaire is opt-in. Skip goes straight to the account.
// Either way this is a new onboarding, so answers left by an earlier, unfinished run are cleared.
export default function Personalize() {
  const { theme } = useTheme();
  const { clear, setSkipped } = useAnswers();

  return (
    <FlowScreen
      title="Want a plan made for you?"
      subtitle="Four quick questions."
      footer={
        <>
          <Button
            label="Personalize"
            onPress={() => {
              clear();
              router.push('/goal');
            }}
          />
          <Button
            variant="ghost"
            label="Skip for now"
            onPress={() => {
              clear();
              setSkipped(true);
              router.push('/name');
            }}
          />
        </>
      }
    >
      <View style={{ gap: theme.space.lg }}>
        {WHAT_YOU_GET.map((w) => (
          <View key={w.text} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: theme.radius.full,
                backgroundColor: theme.color.surface.default,
                borderWidth: 1,
                borderColor: theme.color.border.default,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={w.icon} size={18} />
            </View>
            <Text style={{ flex: 1 }}>{w.text}</Text>
          </View>
        ))}
      </View>
    </FlowScreen>
  );
}
