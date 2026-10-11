import { router } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OneTapLockup } from '@/components/brand/OneTapMark';
import { OneTapCard } from '@/components/onetap/OneTapCard';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { duration, ease } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

const enter = (delay: number) => FadeInDown.duration(duration.modal).easing(ease.out).delay(delay);

// After Revolut's welcome: the physical card is the hero, because the judge is holding it.
// Lockup on top, the card (front over back, like it was set down on a table), one line of
// promise, then Get started and Log in pinned to the bottom. Rare screen, so it earns a short
// entrance: the card lands first, then the words, then the actions.
export default function Welcome() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.color.surface.page,
        paddingTop: insets.top + theme.space.xl,
        paddingBottom: insets.bottom + theme.space.md,
        paddingHorizontal: theme.pageMargin,
        justifyContent: 'space-between',
      }}
    >
      <Animated.View entering={FadeIn.duration(duration.modal)} style={{ alignItems: 'center' }}>
        <OneTapLockup size={30} color={theme.color.text.primary} />
      </Animated.View>

      <View style={{ paddingVertical: theme.space['2xl'], paddingHorizontal: theme.space.sm }}>
        {/* The tilt lives on an inner View: the entering animation owns the outer transform. */}
        <Animated.View entering={enter(0)} style={{ position: 'absolute', left: theme.space.xl, right: -theme.space.lg, top: theme.space.md }}>
          <View style={{ transform: [{ rotate: '7deg' }] }}>
            <OneTapCard last4="4821" side="back" />
          </View>
        </Animated.View>
        <Animated.View entering={enter(duration.stagger)} style={{ marginTop: theme.space['3xl'] }}>
          <View style={{ transform: [{ rotate: '-6deg' }] }}>
            <OneTapCard last4="4821" status="Best card, automatically" auto />
          </View>
        </Animated.View>
      </View>

      <View style={{ gap: theme.space.lg }}>
        <Animated.View entering={enter(duration.stagger * 2)} style={{ gap: theme.space.sm }}>
          <Text variant="h1" accessibilityRole="header">
            One card. Your best card, every time.
          </Text>
          <Text tone="secondary">Tap once. We pick the card that earns the most.</Text>
        </Animated.View>
        <Animated.View entering={enter(duration.stagger * 3)} style={{ gap: theme.space.sm }}>
          <Button label="Get started" onPress={() => router.push('/personalize')} />
          <Button variant="secondary" label="Log in" onPress={() => router.push('/login')} />
        </Animated.View>
      </View>
    </View>
  );
}
