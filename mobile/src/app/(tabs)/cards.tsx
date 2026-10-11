import { ActionSheetIOS, ScrollView, View } from 'react-native';

import { FormError } from '@/components/onboarding/FormError';
import { Hint } from '@/components/onboarding/Hint';
import { OneTapCard } from '@/components/onetap/OneTapCard';
import { RoutingRules } from '@/components/onetap/RoutingRules';
import { SortableCardList } from '@/components/onetap/SortableCardList';
import { Button } from '@/components/ui/Button';
import { ConfirmMorph } from '@/components/ui/ConfirmMorph';
import { DemoLabel } from '@/components/ui/DemoLabel';
import { Empty, ErrorState, Skeleton } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { Toggle } from '@/components/ui/Toggle';
import { apiMessage } from '@/lib/api';
import { LinkCanceled } from '@/lib/plaid';
import {
  signOut,
  useCardRates,
  useConnectCards,
  useCreateOneTapCard,
  useLinkPhysicalCard,
  useOneTapCard,
  useProfile,
  useReorderCards,
  useSetCardFrozen,
  useSetDefaultCard,
  useUserCards,
} from '@/lib/queries';
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
  // Plaid Link, the same flow as setup step 1. Closing Link isn't a failure.
  const connect = useConnectCards();
  const connectFailed = connect.error && !(connect.error instanceof LinkCanceled) ? connect.error : null;
  const connectError = connectFailed ? (apiMessage(connectFailed) ?? "Your cards didn't connect. Check your connection and try again.") : null;
  // One OneTap card, digital and physical: the physical card attaches to it with a tap on the reader.
  const oneTap = useOneTapCard();
  const createCard = useCreateOneTapCard();
  const linkPhysical = useLinkPhysicalCard();
  const setFrozen = useSetCardFrozen();
  const card = oneTap.data ?? createCard.data ?? null;
  const frozen = card?.state === 'paused';
  const cardCount = cards.data?.length ?? 0;
  const cardError = createCard.error ?? linkPhysical.error ?? setFrozen.error;
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

      <View style={{ gap: theme.space.sm }}>
        <Text variant="h4" accessibilityRole="header">
          Your OneTap card
        </Text>
        {oneTap.isLoading ? (
          <Skeleton aspectRatio={1.6} radius={theme.radius.xl} />
        ) : (
          <OneTapCard
            last4={card?.last4 ?? '••••'}
            status={frozen ? 'Frozen' : manualName ? `Always ${manualName}` : card ? 'Best card, automatically' : undefined}
            auto={!manualName && !frozen}
          />
        )}
        <Text variant="body-sm" tone="secondary">
          {cardCount
            ? `Stands in for your ${cardCount} connected ${cardCount === 1 ? 'card' : 'cards'}: each purchase goes to the one that earns the most.`
            : 'Connect your cards below so it can route each purchase.'}
        </Text>
        {card ? (
          <Text variant="body-sm" tone="secondary">
            {card.physical_linked ? 'Digital and physical card linked.' : 'Digital card ready. The physical card is not linked yet.'}
          </Text>
        ) : null}
        {card ? (
          <Toggle
            label="Freeze card"
            description={frozen ? 'Every tap is declined until you unfreeze it.' : 'Declines every tap at once, without cancelling the card.'}
            value={frozen}
            onValueChange={(v) => setFrozen.mutate({ card, frozen: v })}
          />
        ) : null}
        <FormError text={cardError ? (apiMessage(cardError) ?? "That didn't finish. Check your connection and try again.") : null} />
        <Hint text={linkPhysical.isPending ? 'Hold your physical OneTap card on the reader.' : null} />
        {!card && !oneTap.isLoading ? (
          <Button label="Create my card" loading={createCard.isPending} onPress={() => createCard.mutate()} />
        ) : card && !card.physical_linked ? (
          <Button variant="secondary" label="Link physical card" loading={linkPhysical.isPending} onPress={() => linkPhysical.mutate()} />
        ) : null}
      </View>

      {cards.isLoading ? (
        <View style={{ gap: theme.space.sm }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={64} />
          ))}
        </View>
      ) : cards.error ? (
        <ErrorState what="Your cards did not load." todo="Check your connection and try again." onRetry={() => cards.refetch()} />
      ) : !cards.data?.length ? (
        <Empty
          title="No cards connected"
          body="Connect your credit cards so OneTap can route each purchase."
          action={
            <View style={{ gap: theme.space.sm }}>
              <FormError text={connectError} />
              <Button label="Connect cards" loading={connect.isPending} onPress={() => connect.mutate()} />
            </View>
          }
        />
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

          <View style={{ gap: theme.space.sm }}>
            <FormError text={connectError} />
            <Button variant="secondary" label="Connect another bank" loading={connect.isPending} onPress={() => connect.mutate()} />
          </View>
        </>
      )}

      <View style={{ marginTop: theme.space.xl }}>
        <ConfirmMorph
          label="Sign out"
          variant="secondary"
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
