import { View } from 'react-native';
import Animated, { FadeIn, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/ui/Icon';
import { Money } from '@/components/ui/Money';
import { Text } from '@/components/ui/Text';
import { CATEGORIES } from '@/lib/categories';
import { formatMultiplier } from '@/lib/money';
import { buildReceipt } from '@/lib/receipt';
import type { TransactionRow } from '@/lib/types';
import { duration, ease, scale, spring } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { ReceiptLine } from './ReceiptLine';

// The one meaningful animation in the app: the receipt "prints" into the sheet.
// Body drops 12pt into place (250ms ease-out), then the reward settles from 0.95 on a no-bounce spring.
const printIn = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -12 }] },
    animations: {
      opacity: withTiming(1, { duration: 250, easing: ease.out }),
      transform: [{ translateY: withTiming(0, { duration: 250, easing: ease.out }) }],
    },
  };
};

const rewardIn = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: scale.enter }] },
    animations: {
      opacity: withDelay(80, withTiming(1, { duration: 200, easing: ease.out })),
      transform: [{ scale: withDelay(80, withSpring(1, spring.default)) }],
    },
  };
};

// Reduced motion: keep the state change, drop the travel.
const fadeOnly = FadeIn.duration(duration.reduced);

function Tear() {
  const { theme } = useTheme();
  return <View style={{ borderBottomWidth: 1, borderStyle: 'dashed', borderColor: theme.color.border.strong, marginVertical: theme.space.lg }} />;
}

export function Receipt({ tx, cardName, cardMask }: { tx: TransactionRow; cardName: string; cardMask?: string }) {
  const { theme, reduceMotion } = useTheme();
  const r = buildReceipt(tx, cardName);
  const when = new Date(tx.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <Animated.View entering={reduceMotion ? fadeOnly : printIn}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space.md }}>
        <Text variant="h4" style={{ flexShrink: 1 }}>
          {tx.merchant_name}
        </Text>
        <Money cents={tx.amount_cents} variant="h4" />
      </View>
      <Text variant="body-sm" tone="secondary">
        {CATEGORIES[tx.category_id].label}, {when}
      </Text>

      <Tear />

      <View accessible accessibilityLabel={r.summary}>
        <Text variant="body-sm" tone="secondary">
          Routed to
        </Text>
        <Text variant="h3">
          {cardName}
          {cardMask ? ` •••• ${cardMask}` : ''}
        </Text>
        <Text tone="secondary">
          {formatMultiplier(tx.multiplier)} {CATEGORIES[tx.category_id].label.toLowerCase()}
        </Text>
        <Animated.View entering={reduceMotion ? fadeOnly : rewardIn} style={{ alignSelf: 'flex-end', marginTop: theme.space.md }}>
          <Money cents={tx.reward_value_cents} reward variant="display" />
        </Animated.View>
      </View>

      <Tear />

      <Text variant="h4" accessibilityRole="header" style={{ marginBottom: theme.space.sm }}>
        Why this card
      </Text>
      {r.lines.map((line) => (
        <ReceiptLine key={line.id} line={line} />
      ))}
      {!r.hasComparison ? (
        <Text variant="body-sm" tone="secondary">
          No other cards to compare.
        </Text>
      ) : null}

      {r.autoNote || r.reasonNote ? <Tear /> : null}
      {r.autoNote ? <Text variant="body-sm">{r.autoNote}</Text> : null}
      {r.reasonNote ? (
        <View style={{ flexDirection: 'row', gap: theme.space.sm, marginTop: r.autoNote ? theme.space.sm : 0 }}>
          <Icon name="info" tone="secondary" />
          <Text variant="body-sm" tone="secondary" style={{ flex: 1 }}>
            {r.reasonNote}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}
