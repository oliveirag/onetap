import { formatCents, formatReward } from '@/lib/money';
import type { TypeName } from '@/theme/resolve';
import { RollingNumber } from './RollingNumber';
import { Text, type TextTone } from './Text';

// Always two decimals, tabular figures, integer cents in.
// `roll`: digits roll to a new value (Spending totals when a purchase lands). Off by default.
export function Money({
  cents,
  variant = 'body',
  reward = false,
  tone,
  roll = false,
}: {
  cents: number;
  variant?: TypeName;
  reward?: boolean;
  tone?: TextTone;
  roll?: boolean;
}) {
  const text = reward ? formatReward(cents) : formatCents(cents);
  const label = reward ? `plus ${formatCents(cents)}` : text;
  if (roll) return <RollingNumber text={text} variant={variant} tone={tone} accessibilityLabel={label} />;
  return (
    <Text variant={variant} tone={tone} style={{ fontVariant: ['tabular-nums'] }} accessibilityLabel={label}>
      {text}
    </Text>
  );
}
