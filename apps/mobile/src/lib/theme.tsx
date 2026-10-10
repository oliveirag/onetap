import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

const palette = {
  light: {
    bg: '#F4F5F7', surface: '#FFFFFF', surfaceAlt: '#EEF0F3', text: '#0E1116', textMuted: '#5B6472', border: '#E2E5EA',
    accent: '#0F766E', accentText: '#FFFFFF', accentSoft: '#D5F0EC', success: '#15803D', successSoft: '#DCFCE7',
    danger: '#B91C1C', dangerSoft: '#FEE2E2', warning: '#92400E', warningSoft: '#FEF3C7', card: '#0F172A', cardText: '#F8FAFC',
  },
  dark: {
    bg: '#0B0D10', surface: '#14181D', surfaceAlt: '#1B2027', text: '#E9ECF0', textMuted: '#98A2AF', border: '#262C34',
    accent: '#2DD4BF', accentText: '#04211E', accentSoft: '#0E3B37', success: '#4ADE80', successSoft: '#123522',
    danger: '#F87171', dangerSoft: '#3B1414', warning: '#FBBF24', warningSoft: '#3A2A08', card: '#1E293B', cardText: '#F8FAFC',
  },
};
export type Colors = typeof palette.light;
export type ThemePreference = 'system' | 'light' | 'dark';

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;
export const type = {
  hero: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
};

interface ThemeCtx {
  colors: Colors;
  scheme: 'light' | 'dark';
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children, initial = 'system' }: { children: ReactNode; initial?: ThemePreference }) {
  const system = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>(initial);
  const scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const value = useMemo(() => ({ colors: palette[scheme], scheme, preference, setPreference }), [scheme, preference]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used inside ThemeProvider');
  return v;
}
