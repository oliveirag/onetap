import { View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Money } from '@/components/ui/Money';
import { PressableScale } from '@/components/ui/PressableScale';
import { Text } from '@/components/ui/Text';
import { CATEGORIES } from '@/lib/categories';
import { formatCents, formatMultiplier, formatReward } from '@/lib/money';
import type { TransactionRow as Tx } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';

export function TransactionRow({ tx, cardName, onPress }: { tx: Tx; cardName: string; onPress: () => void }) {
  const { theme } = useTheme();
  const category = CATEGORIES[tx.category_id];
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={0}
      accessibilityRole="button"
      accessibilityLabel={`${tx.merchant_name}, ${formatCents(tx.amount_cents)}, routed to ${cardName}, ${formatMultiplier(tx.multiplier)}, ${formatReward(tx.reward_value_cents)}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, minHeight: 56, paddingVertical: theme.space.sm }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: theme.radius.md,
          backgroundColor: theme.color.surface.default,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={category.icon} tone="secondary" />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1}>{tx.merchant_name}</Text>
        <Text variant="body-sm" tone="secondary" numberOfLines={1}>
          {cardName}, {formatMultiplier(tx.multiplier)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Money cents={tx.amount_cents} />
        <Money cents={tx.reward_value_cents} reward variant="body-sm" tone="secondary" />
      </View>
    </PressableScale>
  );
}
