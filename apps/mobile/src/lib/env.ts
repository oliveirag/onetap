/**
 * Public client configuration (EXPO_PUBLIC_* values are embedded in the app bundle —
 * never put secrets here). On a physical phone use your Mac's LAN IP, not localhost.
 */
export const env = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321',
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  devTools: __DEV__ || process.env.EXPO_PUBLIC_ENABLE_DEV_TOOLS === 'true',
};
