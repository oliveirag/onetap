import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { ModeControl } from '@/components/onetap/ModeControl';
import { CARD_RATIO, OneTapCard } from '@/components/onetap/OneTapCard';
import { TransactionRow } from '@/components/onetap/TransactionRow';
import { DemoLabel } from '@/components/ui/DemoLabel';
import { Money } from '@/components/ui/Money';
import { Empty, ErrorState, Skeleton } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { groupByDay } from '@/lib/feed';
import { formatCents } from '@/lib/money';
import { fakeTap } from '@/lib/mocks/fakeTap';
import { useProfile, useOneTapCard, useSpending, useTransactions, useUserCards } from '@/lib/queries';
import { USE_MOCKS } from '@/lib/supabase';
import { useTheme } from '@/theme/ThemeProvider';

// Wallet home, after Curve: the card, the mode, then one panel holding this month's two numbers
// and the activity grouped by day.
export default function Home() {
  const { theme } = useTheme();
  const profile = useProfile();
  const card = useOneTapCard();
  const cards = useUserCards();
  const txs = useTransactions();
  const spending = useSpending();

  const names = new Map((cards.data ?? []).map((c) => [c.id, c.card_product?.name ?? c.account_name]));
  const auto = profile.data?.routing_mode !== 'manual';
  const manualName = profile.data?.manual_card_id ? names.get(profile.data.manual_card_id) : undefined;
  const status =
    card.data?.state === 'paused' ? 'Frozen' : !profile.data ? undefined : auto ? 'Best card, automatically' : manualName ? `Always ${manualName}` : 'Choose a card';
  // Dev only: long-press the card to simulate a tap at the store (mock mode).
  const devTap = USE_MOCKS && __DEV__ && profile.data && cards.data ? () => fakeTap(profile.data, cards.data) : undefined;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.color.surface.page }}
      contentContainerStyle={{ padding: theme.pageMargin, paddingBottom: theme.space['3xl'], gap: theme.space.xl }}
    >
      {card.data ? (
        <OneTapCard last4={card.data.last4} status={status} auto={auto && card.data.state !== 'paused'} onLongPress={devTap} />
      ) : (
        <Skeleton aspectRatio={CARD_RATIO} radius={theme.radius.xl} />
      )}

      <ModeControl />

      <View
        style={{
          backgroundColor: theme.color.surface.default,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: theme.color.border.default,
          padding: theme.space.lg,
          gap: theme.space.lg,
        }}
      >
        <MonthSummary spending={spending} />

        <View style={{ height: 1, backgroundColor: theme.color.border.default }} />

        <View>
          <Text variant="h4" accessibilityRole="header" style={{ marginBottom: theme.space.xs }}>
            Recent activity
          </Text>
          {txs.isLoading ? (
            // Same box as a TransactionRow (two text lines plus its vertical padding), so rows land in place.
            <View style={{ marginTop: theme.space.sm }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <View key={i} style={{ paddingVertical: theme.space.sm }}>
                  <Skeleton height={44} inPanel />
                </View>
              ))}
            </View>
          ) : txs.error ? (
            <ErrorState what="Activity did not load." todo="Check your connection and try again." onRetry={() => txs.refetch()} />
          ) : !txs.data?.length ? (
            <Empty title="No purchases yet" body="Tap your OneTap card at the store and the result shows up here." />
          ) : (
            groupByDay(txs.data.slice(0, 20)).map((day) => (
              <View key={day.key} style={{ marginTop: theme.space.md }}>
                <Text variant="caption" tone="tertiary" accessibilityRole="header">
                  {day.label}
                </Text>
                {day.items.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    tx={tx}
                    cardName={names.get(tx.routed_card_id) ?? 'Your card'}
                    onPress={() => router.push({ pathname: '/result/[id]', params: { id: tx.id } })}
                  />
                ))}
              </View>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}

// Same month definition as the Spending tab, so the two screens always agree.
function MonthSummary({ spending }: { spending: ReturnType<typeof useSpending> }) {
  const { theme } = useTheme();
  const s = spending.data;

  if (spending.isLoading) {
    return (
      <View style={{ flexDirection: 'row', gap: theme.space.lg }}>
        <Skeleton height={48} width="45%" inPanel />
        <Skeleton height={48} width="45%" inPanel />
      </View>
    );
  }
  if (spending.error || !s) {
    return <ErrorState what="This month did not load." todo="Check your connection and try again." onRetry={() => spending.refetch()} />;
  }
  return (
    <View style={{ gap: theme.space.sm }}>
      <View style={{ flexDirection: 'row', gap: theme.space.lg }}>
        <View style={{ flex: 1 }}>
          <Money cents={s.totalSpendCents} variant="h3" roll />
          <Text variant="body-sm" tone="secondary">
            Spent this month
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Money cents={s.extraCents} reward={s.extraCents >= 0} variant="h3" roll />
          <Text variant="body-sm" tone="secondary">
            Reclaimed this month
          </Text>
        </View>
      </View>
      <Text variant="body-sm" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
        {formatCents(s.rewardsCents)} earned in rewards. Reclaimed is what routing earned beyond your default card.
      </Text>
      {s.projectionDollars != null ? (
        <Text variant="body-sm" style={{ fontVariant: ['tabular-nums'] }}>
          On pace to reclaim about ${s.projectionDollars.toLocaleString('en-US')} a year.
        </Text>
      ) : null}
      {s.hasSeeded || s.projectionDollars != null ? (
        <DemoLabel text={[s.hasSeeded && 'Includes demo history', s.projectionDollars != null && 'yearly figure is an estimate'].filter(Boolean).join(' · ')} />
      ) : null}
    </View>
  );
}
