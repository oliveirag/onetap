import { Easing } from 'react-native-reanimated';

// Mirrors tokens.json motion.*. Never ease-in: entering/exiting uses `out`, on-screen moves `inOut`.
export const ease = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
  inOut: Easing.bezier(0.77, 0, 0.175, 1),
  drawer: Easing.bezier(0.32, 0.72, 0, 1),
  linear: Easing.linear,
};

export const duration = { instant: 0, press: 160, fast: 150, base: 200, modal: 250, drawer: 350, reduced: 150 };

// Apple-style springs: dampingRatio 1 = no bounce. Bounce only after a flick (momentum).
export const spring = {
  default: { duration: 400, dampingRatio: 1 },
  momentum: { duration: 400, dampingRatio: 0.8 },
};

export const scale = { press: 0.97, enter: 0.95 };
