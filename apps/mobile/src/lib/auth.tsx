import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

interface AuthCtx {
  session: Session | null;
  loading: boolean;
  /** True while a password-recovery session is active (reset screen must be shown). */
  recovering: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(fullName: string, email: string, password: string): Promise<{ needsVerification: boolean }>;
  verifyEmailOtp(email: string, token: string): Promise<void>;
  resendVerification(email: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  verifyRecoveryOtp(email: string, token: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
export const authRedirect = () => Linking.createURL('/auth/callback');

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') {
        setRecovering(false);
        // Clear every cached financial query on logout.
        queryClient.clear();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      loading,
      recovering,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        fail(error);
      },
      async signUp(fullName, email, password) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName }, emailRedirectTo: authRedirect() },
        });
        fail(error);
        return { needsVerification: !data.session };
      },
      async verifyEmailOtp(email, token) {
        const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
        fail(error);
      },
      async resendVerification(email) {
        const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: authRedirect() } });
        fail(error);
      },
      async requestPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirect() });
        fail(error);
      },
      async verifyRecoveryOtp(email, token) {
        const { error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
        fail(error);
        setRecovering(true);
      },
      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password });
        fail(error);
        setRecovering(false);
      },
      async signOut() {
        await supabase.auth.signOut();
        queryClient.clear();
      },
    }),
    [session, loading, recovering, queryClient],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
