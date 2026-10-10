import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { resolveTheme, type Scheme, type Theme } from './resolve';
import tokens from './tokens.json';

type Ctx = { theme: Theme; scheme: Scheme; reduceMotion: boolean; reduceTransparency: boolean };

const ThemeCtx = createContext<Ctx | null>(null);
const themes = { dark: resolveTheme(tokens, 'dark'), light: resolveTheme(tokens, 'light') };

// Dark-first: anything other than an explicit light preference renders dark.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme: Scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  const reduceMotion = useReducedMotion();
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceTransparencyEnabled().then(setReduceTransparency);
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
    return () => sub.remove();
  }, []);

  const value = useMemo(
    () => ({ theme: themes[scheme], scheme, reduceMotion, reduceTransparency }),
    [scheme, reduceMotion, reduceTransparency],
  );
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
