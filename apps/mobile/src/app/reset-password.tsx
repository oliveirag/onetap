import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema } from '@reclaimed/shared';
import { Button, ErrorState, Screen, Text, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function ResetPassword() {
  const { updatePassword, signOut } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const { control, handleSubmit, formState } = useForm<{ password: string; confirmPassword: string }>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: '', confirmPassword: '' } });
  const onSubmit = handleSubmit(async (v) => {
    try { await updatePassword(v.password); } catch (e) { setError(e); }
  });
  return (
    <Screen>
      <Text variant="title">Choose a new password</Text>
      <Controller control={control} name="password" render={({ field }) => <TextField label="New password" secureTextEntry textContentType="newPassword" value={field.value} onChangeText={field.onChange} error={formState.errors.password?.message} />} />
      <Controller control={control} name="confirmPassword" render={({ field }) => <TextField label="Confirm password" secureTextEntry value={field.value} onChangeText={field.onChange} error={formState.errors.confirmPassword?.message} />} />
      {error ? <ErrorState error={error} /> : null}
      <Button title="Update password" onPress={onSubmit} loading={formState.isSubmitting} />
      <Button title="Cancel and sign out" variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}
