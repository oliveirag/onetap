import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Enter } from '@/components/ui/Enter';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { duration } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

const STEPS = ["Reading your cards' bonus categories", 'Sorting purchases into categories', 'Picking the best card for each'];
const TICK = 550;

// The processing moment. The math is instant; the pause makes the plan feel made for them.
// Each line checks off in turn, then it hands over to the demo (replace, so Back skips it).
export default function Building() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (done < STEPS.length) {
      const t = setTimeout(() => setDone((d) => d + 1), TICK);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => router.replace('/demo'), 400);
    return () => clearTimeout(t);
  }, [done]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.color.surface.page,
        paddingTop: insets.top,
        paddingHorizontal: theme.pageMargin,
        justifyContent: 'center',
        gap: theme.space['2xl'],
      }}
    >
      <Text variant="h2" accessibilityRole="header" accessibilityLiveRegion="polite">
        Building your plan
      </Text>
      <View style={{ gap: theme.space.lg }}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: theme.radius.full,
                borderWidth: 1,
                borderColor: i < done ? theme.color.border.action : theme.color.border.control,
                backgroundColor: i < done ? theme.color.surface.action : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {i < done ? (
                <Enter kind="fade" ms={duration.fast}>
                  <Icon name="check" size={14} tone="on-action" />
                </Enter>
              ) : null}
            </View>
            <Text tone={i < done ? 'primary' : 'tertiary'} style={{ flex: 1 }}>
              {s}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
