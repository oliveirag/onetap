import { router } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';

import { useAnswers } from '@/components/onboarding/AnswersProvider';
import { CheckBox } from '@/components/onboarding/Choice';
import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PressableScale } from '@/components/ui/PressableScale';
import { Text } from '@/components/ui/Text';
import { CATEGORIES } from '@/lib/categories';
import { progressOf } from '@/lib/onboarding';
import type { CategoryId } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';

const PICKABLE: CategoryId[] = ['dining', 'groceries', 'gas', 'streaming', 'travel'];

// Where the money goes. These become the purchases priced on the plan, so the question pays off.
export default function Spend() {
  const { theme } = useTheme();
  const { answers, update } = useAnswers();
  // Two tiles per row that end on the page margin (a percentage plus a fixed gap overshoots or falls short).
  // Floored so rounding never pushes the second tile onto its own row.
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - theme.pageMargin * 2 - theme.space.sm) / 2);
  const toggle = (id: CategoryId) =>
    update({ spend: answers.spend.includes(id) ? answers.spend.filter((s) => s !== id) : [...answers.spend, id] });

  return (
    <FlowScreen
      title="Where do you spend the most?"
      subtitle="Pick up to three. Your plan starts with these."
      progress={progressOf('spend')}
      footer={<Button label="Build my plan" onPress={() => router.push('/building')} />}
    >
      <View accessibilityLabel="Where you spend the most" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
        {PICKABLE.map((id) => {
          const on = answers.spend.includes(id);
          return (
            <PressableScale
              key={id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={CATEGORIES[id].label}
              hitSlop={0}
              onPress={() => (on || answers.spend.length < 3 ? toggle(id) : update({ spend: [...answers.spend.slice(1), id] }))}
              style={{
                width: tile,
                aspectRatio: 1.3,
                padding: theme.space.md,
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: on ? theme.color.border.focus : theme.color.border.default,
                backgroundColor: on ? theme.color.surface.selected : theme.color.surface.default,
                justifyContent: 'space-between',
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Icon name={CATEGORIES[id].icon} size={24} />
                <CheckBox checked={on} />
              </View>
              <Text style={{ fontFamily: 'JBMono-Medium' }}>{CATEGORIES[id].label}</Text>
            </PressableScale>
          );
        })}
      </View>
    </FlowScreen>
  );
}
