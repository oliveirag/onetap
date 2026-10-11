import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';

import { Field } from '@/components/onboarding/Field';
import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { FormError } from '@/components/onboarding/FormError';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { friendlyAuthError, useAuth } from '@/lib/auth';
import { emailError } from '@/lib/validate';
import { useTheme } from '@/theme/ThemeProvider';

// Returning user. A session lands them where they left off: setup if unfinished, Home if done.
export default function Login() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ email?: string }>();
  const { signIn } = useAuth();
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    const e = { email: emailError(email), password: password ? null : 'Enter your password.' };
    setErrors(e);
    setFormError(null);
    if (e.email || e.password) return;
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setFormError(friendlyAuthError(err).message);
      setBusy(false);
    }
  };

  return (
    <FlowScreen
      title="Welcome back"
      subtitle="Log in with the email you signed up with."
      footer={
        <>
          <FormError text={formError} />
          <Button label="Log in" loading={busy} onPress={submit} />
        </>
      }
    >
      <View style={{ gap: theme.space.lg }}>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          autoFocus={!params.email}
        />
        <Field
          ref={passwordRef}
          label="Password"
          password
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          autoFocus={!!params.email}
        />
      </View>
      <Text variant="body-sm" tone="secondary">
        New to OneTap?{' '}
        <Text variant="body-sm" style={{ textDecorationLine: 'underline' }} accessibilityRole="link" onPress={() => router.replace('/personalize')}>
          Get started
        </Text>
      </Text>
    </FlowScreen>
  );
}
