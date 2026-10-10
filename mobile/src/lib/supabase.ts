import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const USE_MOCKS = process.env.EXPO_PUBLIC_USE_MOCKS === '1';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!USE_MOCKS && (!url || !anonKey)) {
  throw new Error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, or EXPO_PUBLIC_USE_MOCKS=1.');
}

// In mock mode the client is never called; placeholders keep createClient from throwing.
// `||` not `??`: an empty EXPO_PUBLIC_ value from .env arrives as '' and must fall back too.
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'mock-anon-key', {
  // No refresh timer in mock mode: there is no session to refresh.
  auth: { storage: AsyncStorage, autoRefreshToken: !USE_MOCKS, persistSession: !USE_MOCKS, detectSessionInUrl: false },
});
