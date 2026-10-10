import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { duration as d, ease, scale as s } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

// A one-shot mount animation driven by shared values, not a layout animation, so it never
// touches layout (layout animations can leave siblings absolutely positioned when a list
// re-renders). Transform and opacity only, out-eased. Reduced motion: opacity only, 150ms.
// `pop`: DS enter from scale 0.95 (never 0). `drop`: from 8px above, like a receipt printing.
export function Enter({
  kind = 'pop',
  ms = d.modal,
  delay = 0,
  style,
  children,
}: {
  kind?: 'pop' | 'drop' | 'fade';
  ms?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const { reduceMotion } = useTheme();
  const p = useSharedValue(0);

  useEffect(() => {
    p.set(withDelay(reduceMotion ? 0 : delay, withTiming(1, { duration: reduceMotion ? d.reduced : ms, easing: ease.out })));
  }, [p, ms, delay, reduceMotion]);

  const animated = useAnimatedStyle(() => {
    const v = p.get();
    if (reduceMotion || kind === 'fade') return { opacity: v };
    return kind === 'pop'
      ? { opacity: v, transform: [{ scale: s.enter + (1 - s.enter) * v }] }
      : { opacity: v, transform: [{ translateY: -8 * (1 - v) }] };
  });

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
