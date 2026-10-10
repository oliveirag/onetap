import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, ErrorState, Loading, Screen, Text } from '@/components/ui';
import { supabase } from '@/lib/supabase';

/**
 * Deep-link target for email verification and password recovery links
 * (reclaimed://auth/callback?code=…). Exchanges the PKCE code for a session.
 */
export default function AuthCallback() {
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const [error, setError] = useState<string | null>(params.error_description ?? null);

  useEffect(() => {
    if (!params.code) {
      if (!params.error_description) setError('This link is missing its verification code. Enter the 6-digit code from the email instead.');
      return;
    }
    supabase.auth.exchangeCodeForSession(params.code).then(({ error: e }) => {
      if (e) setError(e.message);
      else router.replace('/');
    });
  }, [params.code, params.error_description]);

  return (
    <Screen>
      <Text variant="title">Verifying…</Text>
      {error ? <><ErrorState error={new Error(error)} /><Button title="Back to sign in" onPress={() => router.replace('/sign-in')} /></> : <Loading label="Completing sign-in" />}
    </Screen>
  );
}
