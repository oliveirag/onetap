import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { CategoryBars } from '@/components/onetap/CategoryBars';
import { SpendDonut } from '@/components/onetap/SpendDonut';
import { DemoLabel } from '@/components/ui/DemoLabel';
import { Money } from '@/components/ui/Money';
import { Empty, ErrorState, Skeleton } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { CATEGORIES } from '@/lib/categories';
import { summarizeCards } from '@/lib/dashboard';
import { missedRewards } from '@/lib/missed';
import { formatCents } from '@/lib/money';
import { useCardRates, useCardSpending, useSpending, useUserCards } from '@/lib/queries';
import { useTheme } from '@/theme/ThemeProvider';

// Dashboard (PRD F8: understanding money only). This month's spending on every card connected
// through Plaid, plus what OneTap earned on the purchases it routed. No limits, no declines.
export default function Dashboard() {
  const { theme } = useTheme();
  const spending = useCardSpending();
  const onetap = useSpending();
  const s = spending.data ? summarizeCards(spending.data) : undefined;
  const earned = onetap.data;
  const cards = useUserCards();
  const rates = useCardRates();
  // Same rows as the totals above, re-run through Auto's rule (reclaimed PRD stretch 3).
  const missed = spending.data && cards.data && rates.data ? missedRewards(spending.data, cards.data, rates.data) : null;
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
        <Empty title="No spending this month" body="Purchases on your connected cards show up here." />
      ) : (
        <>
          <View style={{ gap: theme.space.lg }}>
            <View>
              <Text variant="body-sm" tone="secondary">
                Spent
              </Text>
              <Money cents={s.totalSpendCents} variant="h1" roll />
              <Text variant="body-sm" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                {s.purchases} {s.purchases === 1 ? 'purchase' : 'purchases'} on {s.cardCount} {s.cardCount === 1 ? 'card' : 'cards'}
              </Text>
            </View>
            {earned && earned.totalSpendCents > 0 ? (
              <View>
                <Text variant="body-sm" tone="secondary">
                  Rewards
                </Text>
                <Money cents={earned.rewardsCents} reward variant="h3" roll />
              </View>
            ) : null}
            {earned?.insight ? (
              <View style={{ gap: theme.space.xs }}>
                <Text>{earned.insight.sentence}</Text>
                {earned.insight.isDemoHistory ? <DemoLabel text="Based on demo history" /> : null}
              </View>
            ) : null}
            <DemoLabel text="Plaid sandbox transactions" />
          </View>

          {missed && missed.missedCents > 0 ? (
            <View
              style={{
                backgroundColor: theme.color.surface.default,
                borderRadius: theme.radius.xl,
                borderWidth: 1,
                borderColor: theme.color.border.default,
                padding: theme.space.lg,
                gap: theme.space.sm,
              }}
            >
              <Text variant="body-sm" tone="secondary">
                Left on the table this month
              </Text>
              <Money cents={missed.missedCents} variant="h2" roll />
              <Text variant="body-sm" tone="secondary">
                Across {missed.purchases} {missed.purchases === 1 ? 'purchase' : 'purchases'}
                {missed.topCategory ? `, mostly ${CATEGORIES[missed.topCategory.id].label.toLowerCase()}` : ''}
              </Text>
              {missed.worst ? (
                <Text variant="body-sm">
                  {missed.worst.merchant}: {missed.worst.bestName} would have earned {formatCents(missed.worst.cents)} more
                </Text>
              ) : null}
              <DemoLabel text="Reward rates and point values are estimates" />
            </View>
          ) : null}

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
