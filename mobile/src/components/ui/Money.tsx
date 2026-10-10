import { formatCents, formatReward } from '@/lib/money';
import type { TypeName } from '@/theme/resolve';
import { Text, type TextTone } from './Text';

// Always two decimals, tabular figures, integer cents in.
export function Money({ cents, variant = 'body', reward = false, tone }: { cents: number; variant?: TypeName; reward?: boolean; tone?: TextTone }) {
  const text = reward ? formatReward(cents) : formatCents(cents);
  return (
    <Text variant={variant} tone={tone} style={{ fontVariant: ['tabular-nums'] }} accessibilityLabel={reward ? `plus ${formatCents(cents)}` : text}>
      {text}
    </Text>
  );
}
