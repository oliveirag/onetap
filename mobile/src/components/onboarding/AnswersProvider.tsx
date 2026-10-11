import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { emptyAnswers, type Answers } from '@/lib/onboarding';

const KEY = 'onetap.onboarding-answers';

type Name = { first: string; last: string };
type Ctx = {
  answers: Answers;
  update: (patch: Partial<Answers>) => void;
  clear: () => void;
  name: Name;
  setName: (n: Name) => void;
  // True when they chose "Skip for now" on the personalize screen.
  skipped: boolean;
  setSkipped: (s: boolean) => void;
};
const AnswersCtx = createContext<Ctx | null>(null);

// Questionnaire answers before an account exists. Saved on the phone as they change, so closing
// the app mid-questionnaire keeps them; sign-up copies them onto the account and clears this.
// The name is held in memory only, never in storage or route params.
export function AnswersProvider({ children }: { children: ReactNode }) {
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [name, setName] = useState<Name>({ first: '', last: '' });
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setAnswers({ ...emptyAnswers, ...(JSON.parse(raw) as Partial<Answers>) }))
      .catch(() => {});
  }, []);

  const update = useCallback((patch: Partial<Answers>) => {
    setAnswers((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setAnswers(emptyAnswers);
    setName({ first: '', last: '' });
    setSkipped(false);
    AsyncStorage.removeItem(KEY).catch(() => {});
  }, []);

  const value = useMemo(() => ({ answers, update, clear, name, setName, skipped, setSkipped }), [answers, update, clear, name, skipped]);
  return <AnswersCtx.Provider value={value}>{children}</AnswersCtx.Provider>;
}

export function useAnswers() {
  const ctx = useContext(AnswersCtx);
  if (!ctx) throw new Error('useAnswers must be used inside AnswersProvider');
  return ctx;
}
