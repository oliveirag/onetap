import { ActivityIndicator, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';

// DS Button. One primary per view. No disabled state: keep it enabled and explain on press.
// `ready={false}` dims a primary until its form is complete (after Revolut's Continue), so the
// next step is visible but quiet. It still takes the press, and the screen says what's missing.
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  ready = true,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'md' | 'sm';
  icon?: IconName;
  loading?: boolean;
  ready?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.color;
  const dim = variant === 'primary' && !ready;
  const bg = dim ? c.surface.default : { primary: c.surface.action, secondary: c.surface.default, ghost: 'transparent', destructive: c.surface.error }[variant];
  const border = dim ? c.border.default : { primary: c.border.action, secondary: c.border.strong, ghost: 'transparent', destructive: c.surface.error }[variant];
  const fg = dim ? c.text.secondary : variant === 'primary' ? c.text['on-action'] : variant === 'destructive' ? c.text['on-error'] : c.text.primary;

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
        <Text variant="body" style={{ fontFamily: theme.font.medium, color: fg }}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}
