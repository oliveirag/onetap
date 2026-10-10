// Reanimated 4 and Worklets need their JS mocks under Jest (no native runtime).
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  // Not in Reanimated's mock; tests run with motion enabled.
  useReducedMotion: () => false,
}));
