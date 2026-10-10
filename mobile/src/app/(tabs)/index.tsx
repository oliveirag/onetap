import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { ModeControl } from '@/components/onetap/ModeControl';
import { OneTapCard } from '@/components/onetap/OneTapCard';
import { TransactionRow } from '@/components/onetap/TransactionRow';
import { Empty, ErrorState, Skeleton } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { fakeTap } from '@/lib/mocks/fakeTap';
import { useProfile, useOneTapCard, useTransactions, useUserCards } from '@/lib/queries';
import { USE_MOCKS } from '@/lib/supabase';
import { useTheme } from '@/theme/ThemeProvider';

export default function Home() {
  const { theme } = useTheme();
  const profile = useProfile();
  const card = useOneTapCard();
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
      {card.data ? <OneTapCard last4={card.data.last4} onLongPress={devTap} /> : <Skeleton aspectRatio={1.6} radius={theme.radius.xl} />}

      <ModeControl />

      <View>
        <Text variant="h4" accessibilityRole="header" style={{ marginBottom: theme.space.sm }}>
          Recent activity
        </Text>
        {txs.isLoading ? (
          // Same box as a TransactionRow (two text lines plus its vertical padding), so rows land in place.
          <View>
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} style={{ paddingVertical: theme.space.sm }}>
                <Skeleton height={44} />
              </View>
            ))}
          </View>
        ) : txs.error ? (
          <ErrorState what="Activity did not load." todo="Check your connection and try again." onRetry={() => txs.refetch()} />
        ) : !txs.data?.length ? (
          <Empty title="No purchases yet" body="Tap your OneTap card at the store and the result shows up here." />
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
