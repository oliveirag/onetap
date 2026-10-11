import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, View, type TextInput } from 'react-native';

import { useAnswers } from '@/components/onboarding/AnswersProvider';
import { CheckBox } from '@/components/onboarding/Choice';
import { Field } from '@/components/onboarding/Field';
import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { FormError } from '@/components/onboarding/FormError';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { friendlyAuthError, useAuth } from '@/lib/auth';
import { progressOf } from '@/lib/onboarding';
import { emailError, MIN_PASSWORD, passwordError } from '@/lib/validate';
import { useTheme } from '@/theme/ThemeProvider';

// Venmo's "Add your account info": email, password with an eye, the 18+ box, then create.
// A session switches the root gate to setup on its own; no session means "confirm your email".
export default function Account() {
  const { theme } = useTheme();
  const { answers, clear, name, skipped } = useAnswers();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adult, setAdult] = useState(false);
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null; adult?: string | null }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    const e = { email: emailError(email), password: passwordError(password), adult: adult ? null : "Confirm you're 18 or older to continue." };
    setErrors(e);
    setFormError(null);
    if (e.email || e.password || e.adult) return;
    setBusy(true);
    try {
      const result = await signUp({ email: email.trim(), password, fullName: `${name.first} ${name.last}`.trim(), answers });
      clear();
      if (result === 'confirm-email') router.replace({ pathname: '/check-email', params: { email: email.trim() } });
    } catch (err) {
      setFormError(friendlyAuthError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlowScreen
      title="Add your account info"
      subtitle="You'll log in with this email."
      progress={progressOf('account', skipped)}
      footer={
        <>
          <FormError text={formError} />
          <Button label="Create account" ready={!emailError(email) && !passwordError(password) && adult} loading={busy} onPress={submit} />
        </>
      }
    >
      <View style={{ gap: theme.space.lg }}>
        <Field
          label="Email"
          required
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          autoFocus
        />
        <Field
          ref={passwordRef}
          label="Password"
          required
          password
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          placeholder={`At least ${MIN_PASSWORD} characters`}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: adult }}
          accessibilityLabel="I'm at least 18 years old"
          accessibilityHint={errors.adult ?? undefined}
          onPress={() => {
            setAdult((a) => !a);
            setErrors((e) => ({ ...e, adult: null }));
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, minHeight: theme.hitTarget }}
        >
          <CheckBox checked={adult} />
          <Text style={{ flex: 1 }}>{"I'm at least 18 years old"}</Text>
        </Pressable>
        {errors.adult ? <FormError text={errors.adult} /> : null}
      </View>
      <Text variant="body-sm" tone="secondary">
        Already have an account?{' '}
        <Text variant="body-sm" style={{ textDecorationLine: 'underline' }} accessibilityRole="link" onPress={() => router.push('/login')}>
          Log in
        </Text>
      </Text>
    </FlowScreen>
  );
}
