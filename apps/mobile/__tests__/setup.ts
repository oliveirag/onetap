process.env.EXPO_PUBLIC_API_URL = 'http://api.test';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://supabase.test';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';

jest.mock('react-native-plaid-link-sdk', () => ({
  createPlaidLinkSession: jest.fn(async (config: { onSuccess: (s: unknown) => void }) => ({
    open: jest.fn(async () => config.onSuccess({ publicToken: 'public-sandbox-123', metadata: { institution: { id: 'ins_1', name: 'First Platypus Bank' }, accounts: [], linkSessionId: 's' } })),
  })),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: { access_token: 'token' } } })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      signInWithPassword: jest.fn(async () => ({ error: null })),
      signUp: jest.fn(async () => ({ data: { session: null }, error: null })),
      signOut: jest.fn(async () => ({ error: null })),
      verifyOtp: jest.fn(async () => ({ error: null })),
      resend: jest.fn(async () => ({ error: null })),
      resetPasswordForEmail: jest.fn(async () => ({ error: null })),
      updateUser: jest.fn(async () => ({ error: null })),
    },
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: jest.fn() };
});

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
  return {
    router,
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
    Link: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement(Text, { onPress: () => router.push(href) }, children),
    Redirect: () => null,
    Stack: Object.assign(({ children }: { children: React.ReactNode }) => children, { Screen: () => null, Protected: ({ children }: { children: React.ReactNode }) => children }),
  };
});

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('expo-linking', () => ({ createURL: (path: string) => `reclaimed://${path.replace(/^\//, '')}` }));
