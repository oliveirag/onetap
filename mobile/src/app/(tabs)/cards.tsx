import { useRef } from 'react';
import { ActionSheetIOS, ScrollView, View } from 'react-native';

import { FormError } from '@/components/onboarding/FormError';
import { CardCarousel, type CardCarouselHandle } from '@/components/onetap/CardCarousel';
import { CARD_RATIO } from '@/components/onetap/OneTapCard';
import { RoutingRules } from '@/components/onetap/RoutingRules';
import { SortableCardList } from '@/components/onetap/SortableCardList';
import { Button } from '@/components/ui/Button';
import { ConfirmMorph } from '@/components/ui/ConfirmMorph';
import { DemoLabel } from '@/components/ui/DemoLabel';
import { Empty, ErrorState, Skeleton } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { Toggle } from '@/components/ui/Toggle';
import { apiMessage } from '@/lib/api';
import { formatClock, useCountdown } from '@/lib/countdown';
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
  const cardError = createCard.error ?? linkPhysical.error ?? setFrozen.error;
  // The backend waits up to 45 s for the physical card on the reader (ONETAP_ENROLL_WAIT_MS).
  const left = useCountdown(linkPhysical.isPending, 45);
  const carousel = useRef<CardCarouselHandle>(null);
  const defaultId = profile.data?.default_card_id ?? null;
  const manualCard = profile.data?.routing_mode === 'manual' ? cards.data?.find((c) => c.id === profile.data?.manual_card_id) : undefined;
  const manualName = manualCard ? (manualCard.card_product?.name ?? manualCard.account_name) : undefined;

  const onPressCard = (card: UserCardRow) => {
    const name = card.card_product?.name ?? card.account_name;
    if (card.id === defaultId) {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: `${name} is your default card`, message: 'Used when no card wins.', options: ['Done'], cancelButtonIndex: 0 },
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
          <Skeleton aspectRatio={CARD_RATIO} radius={theme.radius.xl} />
        ) : (
          <CardCarousel
            ref={carousel}
            last4={card?.last4 ?? '••••'}
            status={frozen ? 'Frozen' : manualName ? `Always ${manualName}` : card ? 'Best card, automatically' : undefined}
            auto={!manualName && !frozen}
            created={!!card}
            physicalLinked={!!card?.physical_linked}
          />
        )}
        {card ? (
          <Toggle
            label="Freeze card"
            description={frozen ? 'Every tap is declined.' : 'Decline every tap.'}
            value={frozen}
            onValueChange={(v) => setFrozen.mutate({ card, frozen: v })}
          />
        ) : null}
        <FormError text={cardError ? (apiMessage(cardError) ?? "That didn't finish. Check your connection and try again.") : null} />
        {/* Confirm in place (no alert), after Revolut: the button turns into the question. */}
        {!card && !oneTap.isLoading ? (
          <ConfirmMorph
            block
            variant="primary"
            confirmTone="primary"
            label="Create my card"
            prompt="Create your card? It works right away."
            confirmLabel="Create card"
            pendingLabel="Creating your card"
            doneLabel="Card created"
            errorLabel="Your card was not created."
            onConfirm={() => createCard.mutateAsync()}
          />
        ) : card && !card.physical_linked ? (
          <ConfirmMorph
            block
            variant="secondary"
            confirmTone="primary"
            label="Link physical card"
            prompt="Confirm, then tap your card on the reader."
            confirmLabel="Start linking"
            pendingLabel={`Tap your card on the reader · ${formatClock(left)}`}
            doneLabel="Physical card linked"
            errorLabel="The card was not linked."
            onConfirm={() => {
              carousel.current?.show(1);
              return linkPhysical.mutateAsync();
            }}
          />
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
          body="Connect your credit cards to start routing."
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
            {manualName ? (
              <Text variant="body-sm" tone="secondary">
                {`Paused: Manual uses ${manualName}.`}
              </Text>
            ) : null}
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
              Higher card wins ties.
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
