import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { authBackend } from '@/lib/auth';

// expo-router's testing library installs its own Reanimated mock, which has no useReducedMotion.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('react-native-reanimated').useReducedMotion = () => false;

jest.mock('@/lib/haptics', () => ({ haptics: { resultArrived: jest.fn(), select: jest.fn() } }));

// Fake timers would also stall Reanimated and React Query; the flow's own pauses are short.
jest.setTimeout(20_000);

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const field = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);

async function signUpThroughQuestionnaire(email: string, password: string) {
  press('Get started');
  await screen.findByText('Want a plan made for you?');
  press('Personalize');
  await screen.findByText('What do you want from your cards?');
  fireEvent.press(screen.getByRole('radio', { name: 'Stop guessing which card to use' }));
  press('Continue');

  await screen.findByText('What gets in the way?');
  fireEvent.press(screen.getByRole('checkbox', { name: "I can't remember which card earns what" }));
  press('Continue');

  await screen.findByText('Where do you spend the most?');
  fireEvent.press(screen.getByRole('checkbox', { name: 'Dining' }));
  press('Build my plan');

  await screen.findByText('Your OneTap plan', {}, { timeout: 5000 });
  expect(screen.getByText(/OneTap knows every card you own/)).toBeTruthy();
  press('Save my plan');

  await screen.findByText('Tell us about you');
  field('First name', 'Ada');
  field('Last name', 'Lovelace');
  press('Next');

  await screen.findByText('Add your account info');
  field('Email', email);
  field('Password', 'short');
  press('Create account');
  expect(screen.getByText('Use at least 8 characters.')).toBeTruthy();
  expect(screen.getByText("Confirm you're 18 or older to continue.")).toBeTruthy();
  field('Password', password);
  fireEvent.press(screen.getByRole('checkbox', { name: "I'm at least 18 years old" }));
  await act(async () => press('Create account'));
}

async function finishSetup() {
  await screen.findByText('Welcome, Ada. Connect your cards');
  await act(async () => press('Connect cards'));
  await screen.findByText('4 cards found', {}, { timeout: 3000 });
  await act(async () => press('Continue'));

  await screen.findByText('Are these your cards?');
  expect(screen.getByText('Matched to Amex Gold')).toBeTruthy();
  expect(screen.getByText('Other card (1x on everything)')).toBeTruthy();
  await act(async () => press('Looks right'));

  await screen.findByText('How should OneTap pick?');
  await act(async () => press('Continue'));

  await screen.findByText('Meet your OneTap card');
  // Confirm in place: the button becomes the question; a press inside 280 ms counts as a double tap.
  press('Create my card');
  // Step past the guard without waiting (this suite's router may run on fake timers).
  const later = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
  await act(async () => {
    press('Create card'); // the guard reads the clock synchronously, so restore it right away
    later.mockRestore();
  });
  await screen.findByText('Your OneTap card is ready', {}, { timeout: 3000 });
  await act(async () => press('Go to home'));
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('signs up through the questionnaire and setup, then logs back in with the same email', async () => {
  renderRouter('./src/app', { initialUrl: '/' });
  await screen.findByText(/Your best card, every time/);

  await signUpThroughQuestionnaire('ada@example.com', 'analytical1');
  await finishSetup();
  await waitFor(async () => expect((await authBackend.load())?.step).toBe('done'));

  // Sign out returns to Welcome.
  await act(async () => authBackend.signOut());
  await screen.findByText(/Your best card, every time/);

  // Wrong password is refused with a message that says what to do.
  press('Log in');
  await screen.findByText('Welcome back');
  field('Email', 'ada@example.com');
  field('Password', 'wrong-password');
  await act(async () => press('Log in'));
  await screen.findByText("That email and password don't match. Check them and try again.");

  // The right one lands on Home, because setup was finished.
  field('Password', 'analytical1');
  await act(async () => press('Log in'));
  await waitFor(async () => expect((await authBackend.load())?.email).toBe('ada@example.com'));
  await screen.findByText('Recent activity');
  expect(screen.queryByText('Welcome back')).toBeNull();
  expect(screen.queryByText(/Connect your cards/)).toBeNull();
});

it('resumes setup at the saved step after logging in again', async () => {
  renderRouter('./src/app', { initialUrl: '/' });
  await screen.findByText(/Your best card, every time/);
  await signUpThroughQuestionnaire('grace@example.com', 'compiler99');

  await screen.findByText(/Connect your cards/);
  await act(async () => press('Connect cards'));
  await screen.findByText('4 cards found', {}, { timeout: 3000 });
  await act(async () => press('Continue'));
  await screen.findByText('Are these your cards?');

  await act(async () => authBackend.signOut());
  await screen.findByText(/Your best card, every time/);
  await act(async () => authBackend.signIn('grace@example.com', 'compiler99'));
  await screen.findByText('Are these your cards?');
});

it('skips the questionnaire straight to the account', async () => {
  renderRouter('./src/app', { initialUrl: '/' });
  await screen.findByText(/Your best card, every time/);
  press('Get started');
  await screen.findByText('Want a plan made for you?');
  press('Skip for now');
  await screen.findByText('Tell us about you');
  expect(screen.getByLabelText('Step 1 of 2')).toBeTruthy();
  field('First name', 'Alan');
  field('Last name', 'Turing');
  press('Next');
  await screen.findByText('Add your account info');
  expect(screen.getByLabelText('Step 2 of 2')).toBeTruthy();
  field('Email', 'alan@example.com');
  field('Password', 'enigma1234');
  fireEvent.press(screen.getByRole('checkbox', { name: "I'm at least 18 years old" }));
  await act(async () => press('Create account'));
  await screen.findByText('Welcome, Alan. Connect your cards');
});

it('refuses a second account with the same email', async () => {
  await authBackend.signUp({ email: 'ada@example.com', password: 'analytical1', fullName: 'Ada', answers: {} });
  await authBackend.signOut();
  await expect(authBackend.signUp({ email: 'ADA@example.com', password: 'x1234567', fullName: 'Ada', answers: {} })).rejects.toThrow(
    'An account with this email already exists. Log in instead.',
  );
});
