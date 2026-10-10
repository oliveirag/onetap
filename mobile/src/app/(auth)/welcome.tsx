import { router } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OneTapCard } from '@/components/onetap/OneTapCard';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { duration, ease } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

const enter = (delay: number) => FadeInDown.duration(duration.modal).easing(ease.out).delay(delay);

// The hook (Venmo's welcome): the outcome as a big headline, the card with two purchase bubbles
// floating on it, then Sign up and Log in. Rare screen, so it earns a short staggered entrance.
export default function Welcome() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.color.surface.page,
        paddingTop: insets.top + theme.space['2xl'],
        paddingBottom: insets.bottom + theme.space.md,
        paddingHorizontal: theme.pageMargin,
        justifyContent: 'space-between',
      }}
    >
      <Animated.View entering={FadeIn.duration(duration.modal)}>
        <Text variant="display" accessibilityRole="header">
          One card.{'\n'}Your best card, every time.
        </Text>
      </Animated.View>

      <View style={{ paddingVertical: theme.space['2xl'] }}>
        <Animated.View entering={enter(80)} style={{ transform: [{ rotate: '-4deg' }], marginTop: theme.space.xl }}>
          <OneTapCard last4="4821" status="Best card, automatically" auto />
        </Animated.View>
        <Animated.View entering={enter(200)} style={{ position: 'absolute', top: 0, left: 0 }}>
          <Bubble icon="dining" parts={[['Dinner', 'strong'], [' went to ', 'soft'], ['Amex Gold', 'strong']]} />
        </Animated.View>
        <Animated.View entering={enter(320)} style={{ position: 'absolute', bottom: 0, right: 0 }}>
          <Bubble icon="fuel" parts={[['You earned ', 'soft'], ['+$2.09', 'strong'], [' on gas', 'soft']]} />
        </Animated.View>
      </View>

      <View style={{ gap: theme.space.sm }}>
        <Button label="Get started" onPress={() => router.push('/goal')} />
        <Button variant="secondary" label="Log in" onPress={() => router.push('/login')} />
      </View>
    </View>
  );
}

// Venmo's chat-bubble chips: mixed weights in one line, the key words in primary.
function Bubble({ icon, parts }: { icon: IconName; parts: [string, 'strong' | 'soft'][] }) {
  const { theme } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={parts.map(([t]) => t).join('')}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.sm,
        paddingVertical: theme.space.sm,
        paddingLeft: theme.space.sm,
        paddingRight: theme.space.lg,
        borderRadius: theme.radius.full,
        backgroundColor: theme.color.surface.raised,
        borderWidth: 1,
        borderColor: theme.color.border.strong,
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: theme.radius.full,
          backgroundColor: theme.color.surface.default,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={14} />
      </View>
      <Text variant="body-sm">
        {parts.map(([t, w], i) => (
          <Text key={i} variant="body-sm" tone={w === 'strong' ? 'primary' : 'secondary'} style={w === 'strong' ? { fontFamily: 'JBMono-Medium' } : undefined}>
            {t}
          </Text>
        ))}
      </Text>
    </View>
  );
}
