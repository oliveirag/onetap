import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthError, type User } from '@supabase/supabase-js';
import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { AUTH_LIVE, supabase } from './supabase';
import type { OnboardingStep } from './types';

// Email and password accounts (PRD F1). Where the user is in setup lives in the account's own
// metadata (`onboarding_step`), because the hosted profiles table is read-only to the app. That
// also means a returning user resumes setup on any phone.
export type AppSession = { userId: string; email: string; fullName: string | null; step: OnboardingStep };
export type SignUpInput = { email: string; password: string; fullName: string; answers: Record<string, unknown> };
// With "Confirm email" on in Supabase, sign-up returns no session until the link is opened.
export type SignUpResult = 'signed-in' | 'confirm-email';

// Thrown with copy that is safe to show: what happened, then what to do.
export class AuthFailure extends Error {}

const STEPS: OnboardingStep[] = ['connect', 'match', 'mode', 'card', 'done'];
const asStep = (v: unknown): OnboardingStep => (STEPS.includes(v as OnboardingStep) ? (v as OnboardingStep) : 'connect');

const COPY: Record<string, string> = {
  invalid_credentials: "That email and password don't match. Check them and try again.",
  email_not_confirmed: 'Confirm your email first. Open the link we sent you, then log in.',
  user_already_exists: 'An account with this email already exists. Log in instead.',
  email_exists: 'An account with this email already exists. Log in instead.',
  weak_password: 'That password is too easy to guess. Use at least 8 characters with a number.',
  email_address_invalid: 'That email address looks wrong. Check it and try again.',
  over_email_send_rate_limit: 'Too many sign-ups in the last hour. Wait a few minutes and try again.',
  over_request_rate_limit: 'Too many tries in a row. Wait a minute and try again.',
  signup_disabled: 'New accounts are turned off right now. Ask the OneTap team to turn them on.',
};
const OFFLINE = "Couldn't reach OneTap. Check your connection and try again.";

const fail = (code: string) => new AuthFailure(COPY[code] ?? OFFLINE);

export function friendlyAuthError(e: unknown): AuthFailure {
  if (e instanceof AuthFailure) return e;
  return fail(isAuthError(e) ? (e.code ?? '') : '');
}

type Backend = {
  load(): Promise<AppSession | null>;
  subscribe(cb: (s: AppSession | null) => void): () => void;
  signUp(input: SignUpInput): Promise<SignUpResult>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  setStep(step: OnboardingStep): Promise<void>;
};

const toSession = (u: User): AppSession => ({
  userId: u.id,
  email: u.email ?? '',
  fullName: (u.user_metadata?.full_name as string | undefined) ?? null,
  step: asStep(u.user_metadata?.onboarding_step),
});

const live: Backend = {
  async load() {
    const { data } = await supabase.auth.getSession();
    return data.session ? toSession(data.session.user) : null;
  },
  subscribe(cb) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session ? toSession(session.user) : null));
    return () => data.subscription.unsubscribe();
  },
  async signUp({ email, password, fullName, answers }) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // full_name feeds the profiles row (handle_new_auth_user trigger); the rest stays on the account.
      options: { data: { full_name: fullName, onboarding_step: 'connect', onboarding_answers: answers } },
    });
    if (error) throw friendlyAuthError(error);
    // An existing confirmed email comes back as a user with no identities and no error.
    if (data.user && data.user.identities?.length === 0) throw fail('user_already_exists');
    return data.session ? 'signed-in' : 'confirm-email';
  },
  async signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw friendlyAuthError(error);
  },
  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw friendlyAuthError(error);
  },
  async setStep(step) {
    const { error } = await supabase.auth.updateUser({ data: { onboarding_step: step } });
    if (error) throw friendlyAuthError(error);
  },
};

// No Supabase project configured (tests, offline dev): accounts live on this phone only.
const MOCK_KEY = 'onetap.mock-auth';
type MockAccount = { id: string; password: string; fullName: string; step: OnboardingStep };
type MockState = { accounts: Record<string, MockAccount>; current: string | null };
const listeners = new Set<(s: AppSession | null) => void>();

async function readMock(): Promise<MockState> {
  const raw = await AsyncStorage.getItem(MOCK_KEY);
  return raw ? (JSON.parse(raw) as MockState) : { accounts: {}, current: null };
}

async function writeMock(state: MockState) {
  await AsyncStorage.setItem(MOCK_KEY, JSON.stringify(state));
  const s = sessionOf(state);
  listeners.forEach((l) => l(s));
}

function sessionOf(state: MockState): AppSession | null {
  const a = state.current ? state.accounts[state.current] : undefined;
  return a && state.current ? { userId: a.id, email: state.current, fullName: a.fullName, step: a.step } : null;
}

const local: Backend = {
  load: async () => sessionOf(await readMock()),
  subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  async signUp({ email, password, fullName }) {
    const state = await readMock();
    const key = email.trim().toLowerCase();
    if (state.accounts[key]) throw fail('user_already_exists');
    state.accounts[key] = { id: `local-${Date.now()}`, password, fullName, step: 'connect' };
    await writeMock({ ...state, current: key });
    return 'signed-in';
  },
  async signIn(email, password) {
    const state = await readMock();
    const key = email.trim().toLowerCase();
    if (state.accounts[key]?.password !== password) throw fail('invalid_credentials');
    await writeMock({ ...state, current: key });
  },
  async signOut() {
    await writeMock({ ...(await readMock()), current: null });
  },
  async setStep(step) {
    const state = await readMock();
    if (!state.current) return;
    state.accounts[state.current] = { ...state.accounts[state.current], step };
    await writeMock(state);
  },
};

export const authBackend: Backend = AUTH_LIVE ? live : local;

type AuthCtx = { ready: boolean; session: AppSession | null } & Omit<Backend, 'load' | 'subscribe'>;
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AppSession | null>(null);

  useEffect(() => {
    let alive = true;
    authBackend
      .load()
      .then((s) => alive && setSession(s))
      .finally(() => alive && setReady(true));
    const unsubscribe = authBackend.subscribe((s) => alive && setSession(s));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      ready,
      session,
      signUp: authBackend.signUp,
      signIn: authBackend.signIn,
      signOut: authBackend.signOut,
      // Optimistic: the gate moves on at once; the write follows. Each step writes the next one
      // before navigating, so killing the app mid-setup resumes at the same step (PRD F2). A
      // failed write never blocks the flow: the worst case is resuming one step early.
      async setStep(step) {
        setSession((s) => (s ? { ...s, step } : s));
        await authBackend.setStep(step).catch((e: unknown) => console.warn('Saving the setup step failed', e));
      },
    }),
    [ready, session],
  );
  return createElement(Ctx.Provider, { value }, children);
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
