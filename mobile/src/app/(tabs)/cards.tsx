import { ActionSheetIOS, ScrollView, View } from 'react-native';

import { RoutingRules } from '@/components/onetap/RoutingRules';
import { SortableCardList } from '@/components/onetap/SortableCardList';
import { ConfirmMorph } from '@/components/ui/ConfirmMorph';
import { DemoLabel } from '@/components/ui/DemoLabel';
import { Empty, ErrorState, Skeleton } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { signOut, useCardRates, useProfile, useReorderCards, useSetDefaultCard, useUserCards } from '@/lib/queries';
import { routingRules } from '@/lib/rules';
import type { UserCardRow } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';

// Connected cards, their order (ties go to the higher card) and the default card.
export default function Cards() {
  const { theme } = useTheme();
  const cards = useUserCards();
  const profile = useProfile();
  const reorder = useReorderCards();
  const setDefault = useSetDefaultCard();
  const rates = useCardRates();
  const defaultId = profile.data?.default_card_id ?? null;
  const manualCard = profile.data?.routing_mode === 'manual' ? cards.data?.find((c) => c.id === profile.data?.manual_card_id) : undefined;
  const manualName = manualCard ? (manualCard.card_product?.name ?? manualCard.account_name) : undefined;

  const onPressCard = (card: UserCardRow) => {
    const name = card.card_product?.name ?? card.account_name;
    if (card.id === defaultId) {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: `${name} is your default card`, message: 'It is used when routing cannot decide, and it is the baseline for extra value.', options: ['Done'], cancelButtonIndex: 0 },
        () => {},
      );
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      { title: name, message: `${card.account_name}, ending ${card.mask}`, options: ['Set as default card', 'Cancel'], cancelButtonIndex: 1 },
      (i) => {
        if (i === 0) setDefault.mutate(card.id);
      },
    );
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.color.surface.page }}
      contentContainerStyle={{ padding: theme.pageMargin, paddingBottom: theme.space['3xl'], gap: theme.space.lg }}
    >
      <Text variant="h2" accessibilityRole="header">
        Cards
      </Text>

      {cards.isLoading ? (
        <View style={{ gap: theme.space.sm }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={64} />
          ))}
        </View>
      ) : cards.error ? (
        <ErrorState what="Your cards did not load." todo="Check your connection and try again." onRetry={() => cards.refetch()} />
      ) : !cards.data?.length ? (
        <Empty title="No cards connected" body="Connect your credit cards so OneTap can route each purchase." />
      ) : (
        <>
          <View style={{ gap: theme.space.sm }}>
            <Text variant="h4" accessibilityRole="header">
              Routing rules
            </Text>
            <Text variant="body-sm" tone="secondary">
              {manualName
                ? `Manual is on, so every purchase uses ${manualName}. These rules apply when you switch back to Auto.`
                : 'Auto sends each purchase to the card that earns the most for its category.'}
            </Text>
            {rates.isLoading ? (
              <Skeleton height={6 * 56} radius={theme.radius.xl} />
            ) : rates.error ? (
              <ErrorState what="Reward rates did not load." todo="Check your connection and try again." onRetry={() => rates.refetch()} />
            ) : (
              <RoutingRules rules={routingRules(cards.data, rates.data ?? [])} manualName={manualName} />
            )}
          </View>

          <View style={{ gap: theme.space.sm, marginTop: theme.space.lg }}>
            <Text variant="h4" accessibilityRole="header">
              Card order
            </Text>
            <Text variant="body-sm" tone="secondary">
              Order breaks ties: when two cards earn the same, the one higher up wins. Hold a card and drag to reorder.
            </Text>
            <SortableCardList cards={cards.data} defaultId={defaultId} onReorder={(order) => reorder.mutate(order)} onPressCard={onPressCard} />
            <DemoLabel text="Point balances are demo estimates" />
          </View>
        </>
      )}

      <View style={{ marginTop: theme.space.xl }}>
        <ConfirmMorph
          label="Sign out"
          prompt="Sign out of OneTap on this phone?"
          confirmLabel="Sign out"
          pendingLabel="Signing out"
          doneLabel="Signed out"
          errorLabel="Sign out did not finish."
          onConfirm={signOut}
        />
      </View>
    </ScrollView>
  );
}
