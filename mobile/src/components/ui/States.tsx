import type { ReactNode } from 'react';
import { View, type DimensionValue } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

// Static placeholder at the final size so nothing jumps when data lands. No shimmer.
// `aspectRatio` sizes it like a ratio-bound view (the OneTap card) instead of a fixed height.
export function Skeleton({
  height,
  width = '100%',
  radius,
  aspectRatio,
}: {
  height?: number;
  width?: DimensionValue;
  radius?: number;
  aspectRatio?: number;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ height, width, aspectRatio, borderRadius: radius ?? theme.radius.md, backgroundColor: theme.color.surface.default }} />
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={{ paddingVertical: theme.space['2xl'], gap: theme.space.sm }}>
      <Text variant="h4">{title}</Text>
      <Text tone="secondary">{body}</Text>
      {action ? <View style={{ marginTop: theme.space.md, alignSelf: 'flex-start' }}>{action}</View> : null}
    </View>
  );
}

// Errors say what happened, then what to do.
export function ErrorState({ what, todo, onRetry }: { what: string; todo: string; onRetry?: () => void }) {
  const { theme } = useTheme();
  return (
    <View style={{ paddingVertical: theme.space['2xl'], gap: theme.space.sm }} accessibilityRole="alert">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
        <Icon name="alert" tone="error" />
        <Text variant="h4" tone="error">
          {what}
        </Text>
      </View>
      <Text tone="secondary">{todo}</Text>
      {onRetry ? (
        <View style={{ marginTop: theme.space.md, alignSelf: 'flex-start' }}>
          <Button variant="secondary" label="Try again" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}
