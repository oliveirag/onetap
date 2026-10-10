import { useState } from 'react';
import { Button, ErrorState, Screen, Text, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { forgotPasswordSchema } from '@reclaimed/shared';

export default function ForgotPassword() {
  const { requestPasswordReset, verifyRecoveryOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Screen edges={[]}>
      <Text variant="title">Reset your password</Text>
      {!sent ? (
        <>
          <Text muted>Enter your email and we’ll send a reset code.</Text>
          <TextField label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          {error ? <ErrorState error={error} /> : null}
          <Button title="Send reset code" loading={busy} onPress={() => run(async () => {
            const v = forgotPasswordSchema.safeParse({ email: email.trim() });
            if (!v.success) throw new Error('Enter a valid email.');
            await requestPasswordReset(v.data.email);
            setSent(true);
          })} />
        </>
      ) : (
        <>
          <Text muted>Enter the 6-digit code sent to {email}. You’ll then choose a new password.</Text>
          <TextField label="Reset code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} textContentType="oneTimeCode" />
          {error ? <ErrorState error={error} /> : null}
          <Button title="Continue" loading={busy} disabled={code.length !== 6} onPress={() => run(() => verifyRecoveryOtp(email.trim(), code.trim()))} />
        </>
      )}
    </Screen>
  );
}
