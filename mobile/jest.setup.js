// Tests always run on the typed mock fixtures, never a real Supabase project.
process.env.EXPO_PUBLIC_USE_MOCKS = '1';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(() => Promise.resolve({ isConnected: true })),
}));

// Reanimated 4 and Worklets need their JS mocks under Jest (no native runtime).
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  // Not in Reanimated's mock; tests run with motion enabled.
  useReducedMotion: () => false,
}));
