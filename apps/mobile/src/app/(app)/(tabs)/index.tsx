import { View } from 'react-native';
import { router } from 'expo-router';
import { useDashboard, useHardwareStatus } from '@/lib/queries';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Money, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { BankTxnRow, ReclaimedCardVisual, SimTxnRow } from '@/components/finance';
import { spacing } from '@/lib/theme';
import { env } from '@/lib/env';

export default function Home() {
  const q = useDashboard();
  const hw = useHardwareStatus(env.devTools);
  const d = q.data;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Text variant="title">Home</Text>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {d && (
        <>
          <Card>
            <Text variant="label" muted>REPORTED BY YOUR BANKS (PLAID)</Text>
            <Row>
              <View>
                <Text variant="caption" muted>Known credit card balances</Text>
                <Money cents={d.real.totalKnownCreditBalanceCents} variant="hero" />
              </View>
            </Row>
            <Row>
              <Text muted>{d.real.connectedCreditCards} credit card{d.real.connectedCreditCards === 1 ? '' : 's'} · {d.real.institutions.length} institution{d.real.institutions.length === 1 ? '' : 's'}</Text>
              <Text variant="caption" muted>{d.real.lastSyncedAt ? `Synced ${new Date(d.real.lastSyncedAt).toLocaleTimeString()}` : 'Not synced'}</Text>
            </Row>
            {d.real.institutions.some((i) => i.status === 'LOGIN_REQUIRED') && <Badge label="An institution needs to be reconnected" tone="warning" />}
            {d.real.institutions.length === 0 && <Button title="Connect a bank" icon="add-circle-outline" onPress={() => router.push('/connect-bank')} />}
          </Card>

          <SectionHeader title="Reclaimed card" action={<Button title="Manage" variant="ghost" onPress={() => router.push('/reclaimed-card')} />} />
          <ReclaimedCardVisual card={d.simulated.reclaimedCard} />
          {env.devTools && (
            <Row>
              <Text variant="caption" muted>NFC reader</Text>
              <Badge label={hw.data?.readers.some((r) => r.connected) ? 'ACR1252U connected' : 'Reader offline'} tone={hw.data?.readers.some((r) => r.connected) ? 'success' : 'neutral'} />
            </Row>
          )}

          <SectionHeader title="Recent simulated purchases" action={<Button title="All" variant="ghost" onPress={() => router.push('/activity')} />} />
          <Card>
            <Text variant="caption" muted>Simulated with mock funding — never counted as real bank spending.</Text>
            {d.simulated.recentTransactions.length === 0 ? <EmptyState icon="flash-outline" title="No simulated purchases yet" body="Start a checkout on the test terminal and tap your Reclaimed card." /> :
              d.simulated.recentTransactions.map((t) => <SimTxnRow key={t.id} t={t} onPress={() => router.push(`/transactions/${t.id}`)} />)}
          </Card>

          <SectionHeader title="Recent bank transactions" />
          <Card>
            {d.real.recentTransactions.length === 0 ? <EmptyState icon="receipt-outline" title="No bank transactions yet" body="Transactions appear after Plaid finishes syncing." /> :
              d.real.recentTransactions.map((t) => <BankTxnRow key={t.id} t={t} />)}
          </Card>
          <View style={{ height: spacing.lg }} />
        </>
      )}
    </Screen>
  );
}
