import { View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { PressableScale } from '@/components/ui/PressableScale';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

// The one inverse object on screen: the mono accent is literally the card.
// `status` says what the card does right now ("Best card, automatically" in Auto,
// "Always Amex Gold" in Manual), printed on the face like Curve's "Used automatically".
export function ReclaimedCard({ last4, status, auto = false, onLongPress }: { last4: string; status?: string; auto?: boolean; onLongPress?: () => void }) {
  const { theme } = useTheme();
  const face = (
    <View
      accessible
      accessibilityLabel={`Reclaimed card ending ${last4}${status ? `, ${status}` : ''}`}
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
        Reclaimed
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.space.md }}>
        <Text tone="on-action" style={{ fontVariant: ['tabular-nums'] }}>
          •••• {last4}
        </Text>
        {status ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs, flexShrink: 1 }}>
            {auto ? <Icon name="auto" size={14} tone="on-action" /> : null}
            <Text variant="body-sm" tone="on-action" numberOfLines={1} style={{ flexShrink: 1 }}>
              {status}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
  if (!onLongPress) return face;
  return (
    <PressableScale onLongPress={onLongPress} delayLongPress={400} hitSlop={0}>
      {face}
    </PressableScale>
  );
}
