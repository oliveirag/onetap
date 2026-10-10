import 'react-native-url-polyfill/auto';
import './crypto-polyfill';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { secureStorage } from './secure-storage';

export const supabase = createClient(env.supabaseUrl, env.supabasePublishableKey || 'missing-publishable-key', {
  auth: {
    storage: Platform.OS === 'web' ? undefined : secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// Refresh tokens only while the app is foregrounded (Supabase guidance for React Native).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}
