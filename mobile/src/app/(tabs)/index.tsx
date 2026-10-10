import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { ModeControl } from '@/components/reclaimed/ModeControl';
import { ReclaimedCard } from '@/components/reclaimed/ReclaimedCard';
import { TransactionRow } from '@/components/reclaimed/TransactionRow';
import { Empty, ErrorState, Skeleton } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { fakeTap } from '@/lib/mocks/fakeTap';
import { useProfile, useReclaimedCard, useTransactions, useUserCards } from '@/lib/queries';
import { USE_MOCKS } from '@/lib/supabase';
import { useTheme } from '@/theme/ThemeProvider';

export default function Home() {
  const { theme } = useTheme();
  const profile = useProfile();
  const card = useReclaimedCard();
  const cards = useUserCards();
  const txs = useTransactions();

  const names = new Map((cards.data ?? []).map((c) => [c.id, c.card_product?.name ?? c.account_name]));
  // Dev only: long-press the card to simulate a tap at the store (mock mode).
  const devTap = USE_MOCKS && __DEV__ && profile.data && cards.data ? () => fakeTap(profile.data, cards.data) : undefined;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.color.surface.page }}
      contentContainerStyle={{ padding: theme.pageMargin, paddingBottom: theme.space['3xl'], gap: theme.space.xl }}
    >
      {card.data ? <ReclaimedCard last4={card.data.last4} onLongPress={devTap} /> : <Skeleton height={210} radius={theme.radius.xl} />}

      <ModeControl />

      <View>
        <Text variant="h4" accessibilityRole="header" style={{ marginBottom: theme.space.sm }}>
          Recent activity
        </Text>
        {txs.isLoading ? (
          <View style={{ gap: theme.space.sm }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={56} />
            ))}
          </View>
        ) : txs.error ? (
          <ErrorState what="Activity did not load." todo="Check your connection and try again." onRetry={() => txs.refetch()} />
        ) : !txs.data?.length ? (
          <Empty title="No purchases yet" body="Tap your Reclaimed card at the store and the result shows up here." />
        ) : (
          txs.data.slice(0, 20).map((tx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              cardName={names.get(tx.routed_card_id) ?? 'Your card'}
              onPress={() => router.push({ pathname: '/result/[id]', params: { id: tx.id } })}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}
