import { View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { formatMultiplier, formatReward } from '@/lib/money';
import type { ReceiptLine as Line } from '@/lib/receipt';
import { useTheme } from '@/theme/ThemeProvider';

// "Amex Gold ........ 4x   +$0.52  Chosen": a register line with a dotted leader.
export function ReceiptLine({ line }: { line: Line }) {
  const { theme } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${line.name}, ${formatMultiplier(line.multiplier)}, ${formatReward(line.valueCents)}${line.chosen ? ', chosen' : ''}`}
      style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space.sm, minHeight: 28 }}
    >
      <View style={{ width: 16, paddingBottom: 4 }}>{line.chosen ? <Icon name="check" /> : null}</View>
      <Text variant="body-sm" tone={line.chosen ? 'primary' : 'secondary'} numberOfLines={1} style={{ flexShrink: 1 }}>
        {line.name}
      </Text>
      <View style={{ flex: 1, minWidth: theme.space.md, marginBottom: 5, borderBottomWidth: 1, borderStyle: 'dotted', borderColor: theme.color.border.strong }} />
      <Text variant="body-sm" tone={line.chosen ? 'primary' : 'secondary'} style={{ fontVariant: ['tabular-nums'], width: 44, textAlign: 'right' }}>
        {formatMultiplier(line.multiplier)}
      </Text>
      <Text variant="body-sm" tone={line.chosen ? 'primary' : 'secondary'} style={{ fontVariant: ['tabular-nums'], minWidth: 64, textAlign: 'right' }}>
        {formatReward(line.valueCents)}
      </Text>
    </View>
  );
}
