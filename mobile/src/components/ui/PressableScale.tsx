import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { duration, ease, scale, spring } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Feedback on press-in (not release), scale 0.97, springs back. Interruptible by design.
export function PressableScale({ style, children, onPressIn, onPressOut, hitSlop, ...rest }: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle> }) {
  const { reduceMotion } = useTheme();
  const s = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: s.get() }] }));

  return (
    <AnimatedPressable
      {...rest}
      hitSlop={hitSlop ?? 8}
      onPressIn={(e) => {
        if (!reduceMotion) s.set(withTiming(scale.press, { duration: duration.press, easing: ease.out }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.set(withSpring(1, spring.default));
        onPressOut?.(e);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
