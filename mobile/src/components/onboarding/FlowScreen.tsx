import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { PressableScale } from '@/components/ui/PressableScale';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

// After Venmo's sign-up: round back button top left, progress pill top right, a big question,
// then content, with the one primary action pinned to the bottom.
export function FlowScreen({
  title,
  subtitle,
  progress,
  onBack = () => router.back(),
  back = true,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  progress?: { index: number; total: number };
  onBack?: () => void;
  back?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: theme.color.surface.page }}>
      <View
        style={{
          paddingTop: insets.top + theme.space.sm,
          paddingHorizontal: theme.pageMargin,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: insets.top + theme.space.sm + theme.hitTarget,
        }}
      >
        {back ? <BackButton onPress={onBack} /> : <View style={{ width: theme.hitTarget }} />}
        {progress ? <ProgressPill {...progress} /> : null}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: theme.pageMargin, paddingTop: theme.space.xl, gap: theme.space.xl, flexGrow: 1 }}
      >
        <View style={{ gap: theme.space.sm }}>
          <Text variant="h2" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text tone="secondary">{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>

      {footer ? (
        <View style={{ paddingHorizontal: theme.pageMargin, paddingTop: theme.space.md, paddingBottom: insets.bottom + theme.space.md, gap: theme.space.sm }}>
          {footer}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onPress}
      style={{
        width: theme.hitTarget,
        height: theme.hitTarget,
        borderRadius: theme.radius.full,
        backgroundColor: theme.color.surface.default,
        borderWidth: 1,
        borderColor: theme.color.border.default,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="arrow-left" size={18} />
    </PressableScale>
  );
}

// Venmo's pill: the current step is a long bar, the rest are dots. Steps already done are filled.
export function ProgressPill({ index, total }: { index: number; total: number }) {
  const { theme } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${index + 1} of ${total}`}
      accessibilityValue={{ min: 1, max: total, now: index + 1 }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.xs,
        paddingHorizontal: theme.space.md,
        height: theme.controlHeight.sm,
        borderRadius: theme.radius.full,
        backgroundColor: theme.color.surface.default,
        borderWidth: 1,
        borderColor: theme.color.border.default,
      }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            width: i === index ? 20 : 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: i <= index ? theme.color.text.primary : theme.color.border.strong,
          }}
        />
      ))}
    </View>
  );
}
