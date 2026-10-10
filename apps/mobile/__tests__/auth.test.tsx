import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import SignIn from '@/app/(auth)/sign-in';
import SignUp from '@/app/(auth)/sign-up';
import { supabase } from '@/lib/supabase';
import { renderScreen } from './utils';

describe('authentication screens', () => {
  beforeEach(() => jest.clearAllMocks());

  it('validates sign-in input before calling Supabase', async () => {
    await renderScreen(<SignIn />);
    await fireEvent.press(screen.getByTestId('sign-in'));
    expect(await screen.findByText('Enter a valid email.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in with trimmed email', async () => {
    await renderScreen(<SignIn />);
    await fireEvent.changeText(screen.getByTestId('email'), ' ada@example.com ');
    await fireEvent.changeText(screen.getByTestId('password'), 'correct horse 1');
    await fireEvent.press(screen.getByTestId('sign-in'));
    await waitFor(() => expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'correct horse 1' }));
  });

  it('shows invalid-credential errors from Supabase', async () => {
    (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
    await renderScreen(<SignIn />);
    await fireEvent.changeText(screen.getByTestId('email'), 'ada@example.com');
    await fireEvent.changeText(screen.getByTestId('password'), 'wrong');
    await fireEvent.press(screen.getByTestId('sign-in'));
    expect(await screen.findByText('Invalid login credentials')).toBeTruthy();
  });

  it('enforces password rules and routes to email verification after sign-up', async () => {
    await renderScreen(<SignUp />);
    await fireEvent.changeText(screen.getByTestId('fullName'), 'Ada Lovelace');
    await fireEvent.changeText(screen.getByTestId('email'), 'ada@example.com');
    await fireEvent.changeText(screen.getByTestId('password'), 'short');
    await fireEvent.changeText(screen.getByTestId('confirmPassword'), 'different');
    await fireEvent.press(screen.getByTestId('sign-up'));
    expect(await screen.findByText('Use at least 10 characters.')).toBeTruthy();
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('password'), 'longenough123');
    await fireEvent.changeText(screen.getByTestId('confirmPassword'), 'longenough123');
    await fireEvent.press(screen.getByTestId('sign-up'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/verify', params: { email: 'ada@example.com' } }));
  });
});
