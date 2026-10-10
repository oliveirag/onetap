import { View } from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

// The one inverse object on screen: the mono accent is literally the card.
export function OneTapCard({ last4, onLongPress }: { last4: string; onLongPress?: () => void }) {
  const { theme } = useTheme();
  const face = (
    <View
      accessible
      accessibilityLabel={`OneTap card ending ${last4}`}
      style={{
        aspectRatio: 1.6,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.color.surface.action,
        borderWidth: 1,
        borderColor: theme.color.border.action,
        padding: theme.space.xl,
        justifyContent: 'space-between',
      }}
    >
      <Text variant="h4" tone="on-action">
        OneTap
      </Text>
      <Text tone="on-action" style={{ fontVariant: ['tabular-nums'] }}>
        •••• {last4}
      </Text>
    </View>
  );
  if (!onLongPress) return face;
  return (
    <PressableScale onLongPress={onLongPress} delayLongPress={400} hitSlop={0}>
      {face}
    </PressableScale>
  );
}
