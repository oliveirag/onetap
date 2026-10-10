import { View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { formatCents } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';

type Row = { id: string; label: string; cents: number };

// Single-series horizontal bars: one neutral fill, label left and value right on the same row,
// largest first, no legend. Every value is printed, so the list doubles as the table view.
export function CategoryBars({ title, rows }: { title: string; rows: Row[] }) {
  const { theme } = useTheme();
  const max = Math.max(1, ...rows.map((r) => r.cents));
  const total = rows.reduce((sum, r) => sum + r.cents, 0) || 1;

  return (
    <View style={{ gap: theme.space.md }}>
      <Text variant="h4" accessibilityRole="header">
        {title}
      </Text>
      {rows.map((r) => (
        <View
          key={r.id}
          accessible
          accessibilityLabel={`${r.label}, ${formatCents(r.cents)}, ${Math.round((r.cents / total) * 100)} percent`}
          style={{ gap: theme.space.xs }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space.md }}>
            <Text variant="body-sm" numberOfLines={1} style={{ flexShrink: 1 }}>
              {r.label}
            </Text>
            <Text variant="body-sm" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
              {formatCents(r.cents)}
            </Text>
          </View>
          {/* Thin mark, anchored at the baseline, 4pt rounded data end. */}
          <View
            style={{
              height: 8,
              width: `${Math.max(2, (r.cents / max) * 100)}%`,
              backgroundColor: theme.color.icon.secondary,
              borderTopRightRadius: 4,
              borderBottomRightRadius: 4,
            }}
          />
        </View>
      ))}
    </View>
  );
}
