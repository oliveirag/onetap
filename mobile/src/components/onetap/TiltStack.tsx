import type { ReactNode } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useTheme } from '@/theme/ThemeProvider';

// Small on purpose: the card leans toward the finger, it doesn't flip.
const MAX_ROTATE = 3; // degrees, at the left or right edge of the stack
const MAX_SHIFT = 6; // points, toward the finger, per axis
const PRESSED_SCALE = 0.98;
// While held: critically damped, so it tracks the finger without overshoot.
const FOLLOW = { duration: 250, dampingRatio: 1 };
// On release: under-damped, so it settles back with a small wiggle.
const SETTLE = { duration: 600, dampingRatio: 0.5 };

// Hold anywhere on (or just around) the cards and they lean toward the finger, then wobble back
// on release. 2D only (rotate + translate + scale): on iOS a rotateX/rotateY with perspective puts
// the stack in 3D, where its plane cuts through the two cards and hides the flat views around it.
// Runs on the UI thread; React never re-renders. Reduced motion turns it off: the cards stay put.
export function TiltStack({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme, reduceMotion } = useTheme();
  const w = useSharedValue(1);
  const h = useSharedValue(1);
  const rotate = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);

  const lean = (x: number, y: number) => {
    'worklet';
    // -1..1 from the center of the stack; clamped so a finger in the slop doesn't over-tilt.
    const nx = Math.max(-1, Math.min(1, (x / w.get()) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, (y / h.get()) * 2 - 1));
    // Pressing the right edge turns it clockwise, as if the finger pushed that corner down.
    rotate.set(withSpring(nx * MAX_ROTATE, FOLLOW));
    tx.set(withSpring(nx * MAX_SHIFT, FOLLOW));
    ty.set(withSpring(ny * MAX_SHIFT, FOLLOW));
  };

  const hold = Gesture.Pan()
    .enabled(!reduceMotion)
    .minDistance(0) // begins on touch-down, not after the finger moves
    .shouldCancelWhenOutside(false)
    .hitSlop({ horizontal: theme.space.lg, vertical: theme.space.lg })
    .onBegin((e) => {
      lean(e.x, e.y);
      scale.set(withSpring(PRESSED_SCALE, FOLLOW));
    })
    .onUpdate((e) => lean(e.x, e.y))
    .onFinalize(() => {
      rotate.set(withSpring(0, SETTLE));
      tx.set(withSpring(0, SETTLE));
      ty.set(withSpring(0, SETTLE));
      scale.set(withSpring(1, SETTLE));
    });

  const tilt = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { rotate: `${rotate.get()}deg` }, { scale: scale.get() }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    w.set(Math.max(1, e.nativeEvent.layout.width));
    h.set(Math.max(1, e.nativeEvent.layout.height));
  };

  return (
    <GestureDetector gesture={hold}>
      <Animated.View onLayout={onLayout} style={[style, tilt]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
