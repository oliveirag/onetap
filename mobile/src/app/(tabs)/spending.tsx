import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { CategoryBars } from '@/components/reclaimed/CategoryBars';
import { SpendDonut } from '@/components/reclaimed/SpendDonut';
import { DemoLabel } from '@/components/ui/DemoLabel';
import { Money } from '@/components/ui/Money';
import { Empty, ErrorState, Skeleton } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { useSpending } from '@/lib/queries';
import { useTheme } from '@/theme/ThemeProvider';

// PRD F8: understanding money only. Reclaimed transactions, current month. No limits, no declines.
export default function Spending() {
  const { theme } = useTheme();
  const spending = useSpending();
  const s = spending.data;
  // The donut and the category bars share one active category; the largest until one is tapped.
  const [picked, setPicked] = useState<string | null>(null);
  const activeId = s?.byCategory.some((c) => c.id === picked) ? picked! : (s?.byCategory[0]?.id ?? '');
  const month = new Date().toLocaleString('en-US', { month: 'long' });

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.color.surface.page }}
      contentContainerStyle={{ padding: theme.pageMargin, paddingBottom: theme.space['3xl'], gap: theme.space['2xl'] }}
    >
      <Text variant="h2" accessibilityRole="header">
        {month}
      </Text>

      {spending.isLoading ? (
        <View style={{ gap: theme.space.md }}>
          <Skeleton height={40} width="60%" />
          <Skeleton height={32} width="40%" />
          <Skeleton height={200} />
        </View>
      ) : spending.error ? (
        <ErrorState what="Spending did not load." todo="Check your connection and try again." onRetry={() => spending.refetch()} />
      ) : !s || s.totalSpendCents === 0 ? (
        <Empty title="No spending this month" body="Your purchases through Reclaimed show up here." />
      ) : (
        <>
          <View style={{ gap: theme.space.lg }}>
            <View>
              <Text variant="body-sm" tone="secondary">
                Spent
              </Text>
              <Money cents={s.totalSpendCents} variant="h1" roll />
            </View>
            <View style={{ flexDirection: 'row', gap: theme.space['2xl'] }}>
              <View style={{ flex: 1 }}>
                <Text variant="body-sm" tone="secondary">
                  Rewards earned
                </Text>
                <Money cents={s.rewardsCents} reward variant="h3" roll />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="body-sm" tone="secondary">
                  Extra vs your default card
                </Text>
                <Money cents={s.extraCents} reward variant="h3" roll />
              </View>
            </View>
            {s.hasSeeded ? <DemoLabel text="Includes demo history" /> : null}
          </View>

          <CategoryBars
            title="By category"
            rows={s.byCategory}
            activeId={activeId}
            onSelect={setPicked}
            chart={<SpendDonut rows={s.byCategory} activeId={activeId} onSelect={setPicked} />}
          />
          <CategoryBars title="By card" rows={s.byCard.map((c) => ({ id: c.id, label: c.name, cents: c.cents }))} />
        </>
      )}
    </ScrollView>
  );
}
