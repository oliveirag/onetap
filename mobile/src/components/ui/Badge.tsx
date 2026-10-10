import { View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Variant = 'neutral' | 'solid' | 'outline' | 'error';

// Not clickable. Status is always icon + word, never color alone.
export function Badge({ label, icon, variant = 'neutral' }: { label: string; icon?: IconName; variant?: Variant }) {
  const { theme } = useTheme();
  const c = theme.color;
  const bg = { neutral: c.surface.default, solid: c.surface.action, outline: 'transparent', error: c.surface.error }[variant];
  const border = { neutral: c.border.default, solid: c.border.action, outline: c.border.strong, error: c.surface.error }[variant];
  const fg = variant === 'solid' ? c.text['on-action'] : variant === 'error' ? c.text['on-error'] : c.text.primary;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: theme.space.xs,
        minHeight: 24,
        paddingHorizontal: theme.space.sm,
        borderRadius: theme.radius.full,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: bg,
      }}
    >
      {icon ? <Icon name={icon} size={12} color={fg} /> : null}
      <Text variant="caption" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}
