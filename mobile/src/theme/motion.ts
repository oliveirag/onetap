import { Easing } from 'react-native-reanimated';

// Mirrors tokens.json motion.*. Never ease-in: entering/exiting uses `out`, on-screen moves `inOut`.
export const ease = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
  inOut: Easing.bezier(0.77, 0, 0.175, 1),
  drawer: Easing.bezier(0.32, 0.72, 0, 1),
  linear: Easing.linear,
};

// Slow-motion review: EXPO_PUBLIC_SLOW_MOTION=5 stretches every app animation 5x (dev builds only).
// The iOS simulator's "Slow Animations" only slows Core Animation, not Reanimated, so this is the knob.
const SLOW = __DEV__ ? Number(process.env.EXPO_PUBLIC_SLOW_MOTION) || 1 : 1;
const slow = <T extends Record<string, number>>(o: T): T =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v * SLOW])) as T;

export const duration = slow({ instant: 0, press: 160, fast: 150, base: 200, modal: 250, drawer: 350, reduced: 150, stagger: 80 });

// Apple-style springs: dampingRatio 1 = no bounce. Bounce only after a flick (momentum).
export const spring = {
  default: { duration: 400 * SLOW, dampingRatio: 1 },
  momentum: { duration: 400 * SLOW, dampingRatio: 0.8 },
};

export const scale = { press: 0.97, enter: 0.95 };
