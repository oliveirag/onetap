import { ActivityIndicator, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';

// DS Button. One primary per view. No disabled state: keep it enabled and explain on press.
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'md' | 'sm';
  icon?: IconName;
  loading?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.color;
  const bg = { primary: c.surface.action, secondary: c.surface.default, ghost: 'transparent', destructive: c.surface.error }[variant];
  const border = { primary: c.border.action, secondary: c.border.strong, ghost: 'transparent', destructive: c.surface.error }[variant];
  const fg = variant === 'primary' ? c.text['on-action'] : variant === 'destructive' ? c.text['on-error'] : c.text.primary;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: loading }}
      disabled={loading}
      onPress={onPress}
      style={{
        minHeight: theme.controlHeight[size],
        paddingHorizontal: theme.space.lg,
        borderRadius: theme.radius.md,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
        {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} color={fg} /> : null}
        <Text variant="body" style={{ fontFamily: 'JBMono-Medium', color: fg }}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}
