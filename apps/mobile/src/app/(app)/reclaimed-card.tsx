import { Alert, Switch } from 'react-native';
import { router } from 'expo-router';
import { useHardwareStatus, useMockFunding, useMutations, useReclaimedCards, useSimulatedTransactions } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { env } from '@/lib/env';
import { useTheme } from '@/lib/theme';
import { Badge, Button, Card, EmptyState, ErrorState, KeyValue, ListItem, Loading, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { ReclaimedCardVisual, SimTxnRow } from '@/components/finance';
import { formatCents } from '@reclaimed/shared';

export default function ReclaimedCardScreen() {
  const cards = useReclaimedCards();
  const funding = useMockFunding();
  const hw = useHardwareStatus(env.devTools);
  const card = cards.data?.[0] ?? null;
  const txns = useSimulatedTransactions({ cardId: card?.id, limit: 10 });
  const m = useMutations();
  const { colors } = useTheme();
  const reader = hw.data?.readers.find((r) => r.connected) ?? hw.data?.readers[0];
  const name = (id: string | null) => funding.data?.find((f) => f.id === id);

  if (cards.isLoading) return <Screen edges={[]}><Loading /></Screen>;
  const setFunding = (patch: Partial<{ primaryFundingAccountId: string | null; secondaryFundingAccountId: string | null; fallbackEnabled: boolean }>) => {
    if (!card) return;
    m.setCardFunding.mutate(
      { id: card.id, primaryFundingAccountId: card.primaryFundingAccountId, secondaryFundingAccountId: card.secondaryFundingAccountId, fallbackEnabled: card.fallbackEnabled, ...patch },
      { onError: (e) => Alert.alert('Could not update funding', errorMessage(e)) },
    );
  };
  const pick = (slot: 'primaryFundingAccountId' | 'secondaryFundingAccountId') =>
    Alert.alert(slot === 'primaryFundingAccountId' ? 'Primary mock account' : 'Secondary mock account', 'Fictional accounts only — no real card is charged.', [
      ...(funding.data ?? []).map((f) => ({ text: `${f.displayName} (${formatCents(f.availableCents)})`, onPress: () => setFunding({ [slot]: f.id }) })),
      { text: 'None', onPress: () => setFunding({ [slot]: null }) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);

  return (
    <Screen edges={[]} refreshing={cards.isRefetching} onRefresh={() => { void cards.refetch(); void funding.refetch(); void txns.refetch(); }}>
      <ReclaimedCardVisual card={card} />
      {cards.error && <ErrorState error={cards.error} />}
      {!card ? (
        <Card>
          <EmptyState icon="radio-outline" title="No test card enrolled" body="Enroll a generic NFC card using the ACS ACR1252U reader. It becomes your development Reclaimed card." action={env.devTools ? <Button title="Enroll a card" onPress={() => router.push('/enroll')} testID="enroll" /> : undefined} />
        </Card>
      ) : (
        <>
          <Card>
            <KeyValue label="Test card ID" value={card.displayId} />
            <KeyValue label="NFC identifier" value={`${card.uidMasked} (fingerprinted)`} />
            <KeyValue label="Status" value={<Badge label={card.status} tone={card.status === 'ACTIVE' ? 'success' : 'warning'} />} />
            <KeyValue label="Enrolled" value={card.enrolledAt ? new Date(card.enrolledAt).toLocaleDateString() : '—'} />
            <KeyValue label="Last tap" value={card.lastTappedAt ? new Date(card.lastTappedAt).toLocaleString() : 'Never'} />
            <KeyValue label="NFC reader" value={<Badge label={reader?.connected ? `${reader.model ?? 'Reader'} connected` : 'Reader offline'} tone={reader?.connected ? 'success' : 'neutral'} />} />
            <Row>
              <Button title={card.status === 'FROZEN' ? 'Unfreeze card' : 'Freeze card'} variant={card.status === 'FROZEN' ? 'primary' : 'secondary'} icon="snow-outline" loading={m.setCardStatus.isPending}
                onPress={() => m.setCardStatus.mutate({ id: card.id, status: card.status === 'FROZEN' ? 'ACTIVE' : 'FROZEN' }, { onError: (e) => Alert.alert('Error', errorMessage(e)) })} testID="freeze-toggle" />
            </Row>
          </Card>

          <SectionHeader title="Simulated funding" action={<Button title="Accounts" variant="ghost" onPress={() => router.push('/funding')} />} />
          <Card>
            <Text variant="caption" muted>Deterministic, developer-configured routing. Rewards-based selection is Phase 2.</Text>
            <ListItem icon="star-outline" title="Primary" subtitle={name(card.primaryFundingAccountId)?.displayName ?? 'Default: lowest-priority active account'} onPress={() => pick('primaryFundingAccountId')} />
            <ListItem icon="git-branch-outline" title="Secondary (fallback)" subtitle={name(card.secondaryFundingAccountId)?.displayName ?? 'Not set'} onPress={() => pick('secondaryFundingAccountId')} />
            <Row>
              <Text>Fallback on insufficient funds</Text>
              <Switch value={card.fallbackEnabled} onValueChange={(v) => setFunding({ fallbackEnabled: v })} trackColor={{ true: colors.accent }} accessibilityLabel="Fallback on insufficient funds" />
            </Row>
            <KeyValue label="Per-transaction limit" value={formatCents(card.perTransactionLimitCents)} />
            <KeyValue label="Daily limit" value={formatCents(card.dailyLimitCents)} />
            {(funding.data?.length ?? 0) === 0 && (
              <Button title="Create demo accounts (Mock Citi, Mock Chase)" onPress={() => m.demoSetup.mutate(card.id)} loading={m.demoSetup.isPending} testID="demo-setup" />
            )}
          </Card>

          <SectionHeader title="Recent simulated purchases" />
          <Card>
            {txns.data?.items.length ? txns.data.items.map((t) => <SimTxnRow key={t.id} t={t} onPress={() => router.push(`/transactions/${t.id}`)} />) : <EmptyState icon="flash-outline" title="No purchases yet" body="Start a checkout on the terminal simulator, then tap this card." />}
          </Card>

          {env.devTools && (
            <Card>
              <Text variant="label" muted>DEVELOPMENT</Text>
              <Button title="Enroll a different card" variant="secondary" onPress={() => router.push('/enroll')} />
              {!card.lithicSandboxMapped && <Button title="Map to Lithic Sandbox card" variant="ghost" onPress={() => m.provisionLithic.mutate(card.id, { onError: (e) => Alert.alert('Lithic Sandbox', errorMessage(e)) })} />}
              {card.lithicSandboxMapped && <Badge label="Mapped to Lithic Sandbox" tone="accent" />}
              <Button title="Revoke card" variant="danger" onPress={() => Alert.alert('Revoke card?', 'The physical tag will no longer work with Reclaimed.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Revoke', style: 'destructive', onPress: () => m.setCardStatus.mutate({ id: card.id, status: 'REVOKED' }) }])} />
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
