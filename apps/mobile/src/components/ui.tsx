import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatCents, TEST_MODE_BANNER } from '@reclaimed/shared';
import { radius, spacing, type as typo, useTheme } from '@/lib/theme';
import { errorMessage } from '@/lib/api';

export type IconName = keyof typeof Ionicons.glyphMap;

export function Text({ variant = 'body', muted, color, style, ...rest }: TextProps & { variant?: keyof typeof typo; muted?: boolean; color?: string }) {
  const { colors } = useTheme();
  return <RNText {...rest} style={[typo[variant], { color: color ?? (muted ? colors.textMuted : colors.text) }, style]} />;
}

export function Screen({ children, scroll = true, refreshing, onRefresh, edges = ['top'], padded = true }: {
  children: ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; edges?: ('top' | 'bottom')[]; padded?: boolean;
}) {
  const { colors } = useTheme();
  const inner = padded ? { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 } : undefined;
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.bg }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={inner}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.accent} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  const base: ViewStyle = { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, gap: spacing.sm };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [base, style, pressed && { opacity: 0.75 }]}>
      {children}
    </Pressable>
  );
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, testID }: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; loading?: boolean; disabled?: boolean; icon?: IconName; testID?: string;
}) {
  const { colors } = useTheme();
  const bg = { primary: colors.accent, secondary: colors.surfaceAlt, danger: colors.dangerSoft, ghost: 'transparent' }[variant];
  const fg = { primary: colors.accentText, secondary: colors.text, danger: colors.danger, ghost: colors.accent }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(loading) }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.8 : 1 }, variant === 'ghost' && { minHeight: 40 }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <View style={styles.row}>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <Text variant="heading" color={fg}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export const TextField = forwardRef<TextInput, TextInputProps & { label: string; error?: string; hint?: string }>(function TextField({ label, error, hint, style, ...rest }, ref) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" muted>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        {...rest}
        style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border }, style]}
      />
      {error ? <Text variant="caption" color={colors.danger}>{error}</Text> : hint ? <Text variant="caption" muted>{hint}</Text> : null}
    </View>
  );
});

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'accent' }) {
  const { colors } = useTheme();
  const map = {
    neutral: [colors.surfaceAlt, colors.textMuted], success: [colors.successSoft, colors.success], danger: [colors.dangerSoft, colors.danger],
    warning: [colors.warningSoft, colors.warning], accent: [colors.accentSoft, colors.accent],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text variant="caption" color={fg} style={{ fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, { justifyContent: 'space-between' }, style]}>{children}</View>;
}

export function ListItem({ title, subtitle, right, icon, onPress, testID }: { title: string; subtitle?: string | null; right?: ReactNode; icon?: IconName; onPress?: () => void; testID?: string }) {
  const { colors } = useTheme();
  const content = (
    <View style={[styles.row, { gap: spacing.md, minHeight: 48 }]}>
      {icon && <View style={[styles.iconWrap, { backgroundColor: colors.surfaceAlt }]}><Ionicons name={icon} size={18} color={colors.text} /></View>}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1}>{title}</Text>
        {subtitle ? <Text variant="caption" muted numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress && <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
    </View>
  );
  if (!onPress) return content;
  return <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.6 }}>{content}</Pressable>;
}

export function Money({ cents, variant = 'body', color, signed }: { cents: number | null | undefined; variant?: keyof typeof typo; color?: string; signed?: boolean }) {
  const text = cents === null || cents === undefined ? '—' : `${signed && cents > 0 ? '+' : ''}${formatCents(cents)}`;
  return <Text variant={variant} color={color} style={{ fontVariant: ['tabular-nums'] }}>{text}</Text>;
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <Row style={{ marginTop: spacing.sm }}>
      <Text variant="heading">{title}</Text>
      {action}
    </Row>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.sm }} accessibilityLabel={label}>
      <ActivityIndicator color={colors.accent} />
      <Text variant="caption" muted>{label}</Text>
    </View>
  );
}

export function EmptyState({ icon = 'sparkles-outline', title, body, action }: { icon?: IconName; title: string; body?: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.sm }}>
      <Ionicons name={icon} size={32} color={colors.textMuted} />
      <Text variant="heading" style={{ textAlign: 'center' }}>{title}</Text>
      {body && <Text muted style={{ textAlign: 'center' }}>{body}</Text>}
      {action}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm }} accessibilityRole="alert">
      <Text color={colors.danger}>{errorMessage(error)}</Text>
      {onRetry && <Button title="Try again" variant="ghost" onPress={onRetry} />}
    </View>
  );
}

export function TestModeBanner({ text = TEST_MODE_BANNER }: { text?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: spacing.md, flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }} accessibilityRole="text">
      <Ionicons name="flask-outline" size={18} color={colors.warning} />
      <Text variant="label" color={colors.warning} style={{ flex: 1, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 3 }} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onChange(o.value)}
            style={{ flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: active ? colors.surface : 'transparent' }}>
            <Text variant="label" color={active ? colors.text : colors.textMuted}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Row>
      <Text muted>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? <Text>{value}</Text> : value}
    </Row>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  button: { minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, fontSize: 16 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
