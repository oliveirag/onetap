import { useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { duration, ease, spring } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

const CARD_H = 220;

// Agree/disagree cards. The card tracks the finger 1:1 from where it was grabbed; a far enough
// drag or a flick sends it off in that direction with the release velocity, anything less
// springs back. The two buttons do the same thing for anyone who doesn't swipe (and VoiceOver).
export function SwipeDeck({ statements, index, onAnswer }: { statements: string[]; index: number; onAnswer: (agree: boolean) => void }) {
  const { theme } = useTheme();
  const next = statements[index + 1];
  return (
    <View style={{ gap: theme.space.lg }}>
      <View style={{ height: CARD_H + theme.space.md }}>
        {next ? (
          <View style={[cardBox(theme), { position: 'absolute', left: 0, right: 0, top: theme.space.md, transform: [{ scale: 0.95 }] }]}>
            <Statement text={next} />
          </View>
        ) : null}
        {statements[index] ? <TopCard key={index} text={statements[index]} onAnswer={onAnswer} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space.md }}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" icon="thumbs-down" label="Not me" onPress={() => onAnswer(false)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" icon="thumbs-up" label="Me too" onPress={() => onAnswer(true)} />
        </View>
      </View>
    </View>
  );
}

function TopCard({ text, onAnswer }: { text: string; onAnswer: (agree: boolean) => void }) {
  const { theme, reduceMotion } = useTheme();
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const out = width * 1.2;

  const pan = Gesture.Pan()
    .onBegin(() => {
      start.set(x.get());
    })
    .onUpdate((e) => {
      x.set(start.get() + e.translationX);
    })
    .onEnd((e) => {
      const flung = Math.abs(e.velocityX) > 800;
      const far = Math.abs(x.get()) > width * 0.3;
      if (flung || far) {
        const agree = (flung ? e.velocityX : x.get()) > 0;
        x.set(withTiming(agree ? out : -out, { duration: duration.base, easing: ease.out }, () => scheduleOnRN(onAnswer, agree)));
      } else {
        x.set(withSpring(0, { ...spring.momentum, velocity: e.velocityX }));
      }
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { rotate: `${interpolate(x.get(), [-width, width], [-8, 8])}deg` }],
  }));
  const agreeTag = useAnimatedStyle(() => ({ opacity: interpolate(x.get(), [0, 80], [0, 1], 'clamp') }));
  const rejectTag = useAnimatedStyle(() => ({ opacity: interpolate(x.get(), [-80, 0], [1, 0], 'clamp') }));

  return (
    <GestureDetector gesture={pan.enabled(!reduceMotion)}>
      <Animated.View
        accessible
        accessibilityLabel={`"${text}". Use Me too or Not me to answer.`}
        style={[cardBox(theme), { position: 'absolute', left: 0, right: 0, top: 0 }, style]}
      >
        <Animated.View style={[tag(theme), { right: theme.space.lg }, agreeTag]}>
          <Text variant="caption">Me too</Text>
        </Animated.View>
        <Animated.View style={[tag(theme), { left: theme.space.lg }, rejectTag]}>
          <Text variant="caption">Not me</Text>
        </Animated.View>
        <Statement text={text} />
      </Animated.View>
    </GestureDetector>
  );
}

function Statement({ text }: { text: string }) {
  return (
    <Text variant="h3" style={{ textAlign: 'center' }}>
      “{text}”
    </Text>
  );
}

type T = ReturnType<typeof useTheme>['theme'];

const cardBox = (theme: T) => ({
  height: CARD_H,
  borderRadius: theme.radius.xl,
  borderWidth: 1,
  borderColor: theme.color.border.strong,
  backgroundColor: theme.color.surface.raised,
  padding: theme.space.xl,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
});

const tag = (theme: T) => ({
  position: 'absolute' as const,
  top: theme.space.lg,
  paddingHorizontal: theme.space.sm,
  paddingVertical: theme.space.xs,
  borderRadius: theme.radius.sm,
  borderWidth: 1,
  borderColor: theme.color.border.strong,
  backgroundColor: theme.color.surface.default,
});
