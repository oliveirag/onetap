import { useState } from 'react';
import { View } from 'react-native';
import { Link, router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signInSchema, type SignInInput } from '@reclaimed/shared';
import { Button, ErrorState, Screen, Text, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { spacing, useTheme } from '@/lib/theme';

export default function SignIn() {
  const { signIn } = useAuth();
  const { colors } = useTheme();
  const [error, setError] = useState<unknown>(null);
  const { control, handleSubmit, formState, getValues } = useForm<SignInInput>({ resolver: zodResolver(signInSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await signIn(v.email.trim(), v.password);
    } catch (e) {
      if (/confirm/i.test((e as Error).message)) router.push({ pathname: '/verify', params: { email: getValues('email') } });
      else setError(e);
    }
  });

  return (
    <Screen>
      <View style={{ marginTop: spacing.xxl * 1.5, gap: spacing.sm }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="title" color={colors.accentText}>R</Text>
        </View>
        <Text variant="hero">Welcome back</Text>
        <Text muted>Sign in to manage your cards and your Reclaimed test card.</Text>
      </View>
      <Controller control={control} name="email" render={({ field }) => (
        <TextField label="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={formState.errors.email?.message} testID="email" />
      )} />
      <Controller control={control} name="password" render={({ field }) => (
        <TextField label="Password" secureTextEntry autoComplete="current-password" textContentType="password" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={formState.errors.password?.message} testID="password" />
      )} />
      {error ? <ErrorState error={error} /> : null}
      <Button title="Sign in" onPress={onSubmit} loading={formState.isSubmitting} testID="sign-in" />
      <Link href="/forgot-password" style={{ color: colors.accent, textAlign: 'center', padding: spacing.sm }}>Forgot password?</Link>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
        <Text muted>New to Reclaimed?</Text>
        <Link href="/sign-up" style={{ color: colors.accent, fontWeight: '600' }}>Create an account</Link>
      </View>
    </Screen>
  );
}
