import { useState } from 'react';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signUpSchema, type SignUpInput } from '@reclaimed/shared';
import { Button, ErrorState, Screen, Text, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function SignUp() {
  const { signUp } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const { control, handleSubmit, formState } = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema), defaultValues: { fullName: '', email: '', password: '', confirmPassword: '' } });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await signUp(v.fullName, v.email.trim(), v.password);
      if (r.needsVerification) router.replace({ pathname: '/verify', params: { email: v.email.trim() } });
    } catch (e) {
      setError(e);
    }
  });

  const field = (name: keyof SignUpInput, label: string, props: object = {}) => (
    <Controller control={control} name={name} render={({ field: f }) => (
      <TextField label={label} value={f.value} onChangeText={f.onChange} onBlur={f.onBlur} error={formState.errors[name]?.message} testID={name} {...props} />
    )} />
  );

  return (
    <Screen edges={[]}>
      <Text variant="title">Create your account</Text>
      <Text muted>Phase 1 is a test prototype. No real money is moved.</Text>
      {field('fullName', 'Full name', { autoComplete: 'name', textContentType: 'name' })}
      {field('email', 'Email', { autoCapitalize: 'none', keyboardType: 'email-address', autoComplete: 'email', textContentType: 'emailAddress' })}
      {field('password', 'Password', { secureTextEntry: true, autoComplete: 'new-password', textContentType: 'newPassword', hint: 'At least 10 characters with a letter and a number.' })}
      {field('confirmPassword', 'Confirm password', { secureTextEntry: true, textContentType: 'newPassword' })}
      {error ? <ErrorState error={error} /> : null}
      <Button title="Create account" onPress={onSubmit} loading={formState.isSubmitting} testID="sign-up" />
    </Screen>
  );
}
