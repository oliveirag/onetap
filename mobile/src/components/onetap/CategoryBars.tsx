import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { formatCents } from '@/lib/money';
import { CHART_DIM, chartColor } from '@/theme/chart';
import { useTheme } from '@/theme/ThemeProvider';

type Row = { id: string; label: string; cents: number };

// Horizontal bars, label left and value right on the same row, largest first, no legend. Every
// value is printed, so the list doubles as the table view. Alone, they are one series in the
// first chart blue. With `onSelect`, rows are the donut's legend: each bar takes its arc's blue
// (same rank, same color), and the bars other than the active one recede like their arcs.
export function CategoryBars({
  title,
  rows,
  chart,
  activeId,
  onSelect,
}: {
  title: string;
  rows: Row[];
  chart?: ReactNode;
  activeId?: string;
  onSelect?: (id: string) => void;
}) {
  const { theme, scheme } = useTheme();
  const max = Math.max(1, ...rows.map((r) => r.cents));
  const total = rows.reduce((sum, r) => sum + r.cents, 0) || 1;

  return (
    <View style={{ gap: theme.space.md }}>
      <Text variant="h4" accessibilityRole="header">
        {title}
      </Text>
      {chart}
      {rows.map((r, i) => {
        const selected = onSelect ? r.id === activeId : false;
        const label = `${r.label}, ${formatCents(r.cents)}, ${Math.round((r.cents / total) * 100)} percent`;
        const body = (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space.md }}>
              <Text
                variant="body-sm"
                tone={onSelect && !selected ? 'secondary' : 'primary'}
                numberOfLines={1}
                style={{ flexShrink: 1, fontFamily: selected ? theme.font.medium : theme.font.regular }}
              >
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
                backgroundColor: chartColor(scheme, onSelect ? i : 0),
                opacity: onSelect && !selected ? CHART_DIM : 1,
                borderTopRightRadius: 4,
                borderBottomRightRadius: 4,
              }}
            />
          </>
        );

        return onSelect ? (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => !selected && onSelect(r.id)}
            style={{ gap: theme.space.xs, minHeight: theme.hitTarget, justifyContent: 'center' }}
          >
            {body}
          </Pressable>
        ) : (
          <View key={r.id} accessible accessibilityLabel={label} style={{ gap: theme.space.xs }}>
            {body}
          </View>
        );
      })}
    </View>
  );
}
