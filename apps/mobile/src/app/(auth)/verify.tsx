import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Button, ErrorState, Screen, Text, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function Verify() {
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const { verifyEmailOtp, resendVerification } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyEmailOtp(email, code.trim());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <Text variant="title">Verify your email</Text>
      <Text muted>We sent a 6-digit code and a link to {email || 'your email'}. Enter the code, or open the link on this device.</Text>
      <TextField label="Verification code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} autoComplete="one-time-code" textContentType="oneTimeCode" testID="otp" />
      {error ? <ErrorState error={error} /> : null}
      <Button title="Verify" onPress={verify} loading={busy} disabled={code.trim().length !== 6} />
      <Button title={sent ? 'Code sent' : 'Resend code'} variant="ghost" disabled={sent || !email} onPress={() => resendVerification(email).then(() => setSent(true), setError)} />
    </Screen>
  );
}
