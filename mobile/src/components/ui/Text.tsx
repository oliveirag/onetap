import { Text as RNText, type TextProps } from 'react-native';

import type { TypeName } from '@/theme/resolve';
import { useTheme } from '@/theme/ThemeProvider';

export type TextTone = 'primary' | 'secondary' | 'tertiary' | 'error' | 'on-action' | 'action';

export function Text({ variant = 'body', tone = 'primary', style, ...rest }: TextProps & { variant?: TypeName; tone?: TextTone }) {
  const { theme } = useTheme();
  return <RNText {...rest} style={[theme.type[variant], { color: theme.color.text[tone] }, style]} />;
}
