import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { CategoryBars } from '@/components/onetap/CategoryBars';
import { SpendDonut } from '@/components/onetap/SpendDonut';
import { DemoLabel } from '@/components/ui/DemoLabel';
import { Money } from '@/components/ui/Money';
import { Empty, ErrorState, Skeleton } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { summarizeCards } from '@/lib/dashboard';
import { useCardSpending, useSpending } from '@/lib/queries';
import { useTheme } from '@/theme/ThemeProvider';

// Dashboard (PRD F8: understanding money only). This month's spending on every card connected
// through Plaid, plus what OneTap earned on the purchases it routed. No limits, no declines.
export default function Dashboard() {
  const { theme } = useTheme();
  const spending = useCardSpending();
  const onetap = useSpending();
  const s = spending.data ? summarizeCards(spending.data) : undefined;
  const earned = onetap.data;
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
        <Empty title="No spending this month" body="Purchases on the cards you connect show up here." />
      ) : (
        <>
          <View style={{ gap: theme.space.lg }}>
            <View>
              <Text variant="body-sm" tone="secondary">
                Spent across your cards
              </Text>
              <Money cents={s.totalSpendCents} variant="h1" roll />
              <Text variant="body-sm" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                {s.purchases} {s.purchases === 1 ? 'purchase' : 'purchases'} on {s.cardCount} {s.cardCount === 1 ? 'card' : 'cards'}
              </Text>
            </View>
            {earned && earned.totalSpendCents > 0 ? (
              <View style={{ flexDirection: 'row', gap: theme.space['2xl'] }}>
                <View style={{ flex: 1 }}>
                  <Text variant="body-sm" tone="secondary">
                    Rewards with OneTap
                  </Text>
                  <Money cents={earned.rewardsCents} reward variant="h3" roll />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="body-sm" tone="secondary">
                    Extra vs your default card
                  </Text>
                  <Money cents={earned.extraCents} reward variant="h3" roll />
                </View>
              </View>
            ) : null}
            <DemoLabel text="Plaid sandbox transactions" />
          </View>

          <CategoryBars
            title="By category"
            rows={s.byCategory}
            activeId={activeId}
            onSelect={setPicked}
            chart={<SpendDonut rows={s.byCategory} activeId={activeId} onSelect={setPicked} />}
          />
          <CategoryBars title="By card" rows={s.byCard} />
        </>
      )}
    </ScrollView>
  );
}
