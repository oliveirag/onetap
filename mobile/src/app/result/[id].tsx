import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import { Receipt } from '@/components/onetap/Receipt';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useTransaction, useUserCards } from '@/lib/queries';
import { useTheme } from '@/theme/ThemeProvider';

export default function Result() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const tx = useTransaction(id);
  const cards = useUserCards();
  const routed = cards.data?.find((c) => c.id === tx.data?.routed_card_id);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: theme.pageMargin, paddingTop: theme.space['2xl'], paddingBottom: theme.space['3xl'] }}
    >
      {tx.data ? (
        // key: router.replace swaps the transaction, and the print-in animation replays for the new one.
        <Receipt key={tx.data.id} tx={tx.data} cardName={routed?.card_product?.name ?? routed?.account_name ?? 'Your card'} cardMask={routed?.mask} />
      ) : tx.error ? (
        <ErrorState what="This purchase did not load." todo="Try again, or close this sheet and open it from Home." onRetry={() => tx.refetch()} />
      ) : (
        <Skeleton height={420} />
      )}
    </ScrollView>
  );
}
