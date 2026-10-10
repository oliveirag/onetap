import { ScrollView, View } from 'react-native';

import { CategoryBars } from '@/components/onetap/CategoryBars';
import { DemoLabel } from '@/components/ui/DemoLabel';
import { Money } from '@/components/ui/Money';
import { Empty, ErrorState, Skeleton } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { useSpending } from '@/lib/queries';
import { useTheme } from '@/theme/ThemeProvider';

// PRD F8: understanding money only. OneTap transactions, current month. No limits, no declines.
export default function Spending() {
  const { theme } = useTheme();
  const spending = useSpending();
  const s = spending.data;
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
        <Empty title="No spending this month" body="Your purchases through OneTap show up here." />
      ) : (
        <>
          <View style={{ gap: theme.space.lg }}>
            <View>
              <Text variant="body-sm" tone="secondary">
                Spent
              </Text>
              <Money cents={s.totalSpendCents} variant="h1" />
            </View>
            <View style={{ flexDirection: 'row', gap: theme.space['2xl'] }}>
              <View style={{ flex: 1 }}>
                <Text variant="body-sm" tone="secondary">
                  Rewards earned
                </Text>
                <Money cents={s.rewardsCents} reward variant="h3" />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="body-sm" tone="secondary">
                  Extra vs your default card
                </Text>
                <Money cents={s.extraCents} reward variant="h3" />
              </View>
            </View>
            {s.hasSeeded ? <DemoLabel text="Includes demo history" /> : null}
          </View>

          <CategoryBars title="By category" rows={s.byCategory} />
          <CategoryBars title="By card" rows={s.byCard.map((c) => ({ id: c.id, label: c.name, cents: c.cents }))} />
        </>
      )}
    </ScrollView>
  );
}
