import { router } from 'expo-router';
import { useAccounts, useReclaimedCards } from '@/lib/queries';
import { Button, Card, EmptyState, ErrorState, ListItem, Loading, Screen, SectionHeader, Text, Badge } from '@/components/ui';
import { AccountRow, ConnectionBadge } from '@/components/finance';

export default function Cards() {
  const accounts = useAccounts();
  const cards = useReclaimedCards();
  const credit = accounts.data?.filter((a) => a.type === 'credit') ?? [];
  const other = accounts.data?.filter((a) => a.type !== 'credit') ?? [];
  const rc = cards.data?.[0];
  return (
    <Screen refreshing={accounts.isRefetching} onRefresh={() => { void accounts.refetch(); void cards.refetch(); }}>
      <Text variant="title">Cards</Text>
      <Card onPress={() => router.push('/reclaimed-card')} accessibilityLabel="Open Reclaimed card management">
        <ListItem icon="radio-outline" title="Reclaimed Card" subtitle={rc ? `${rc.displayId} · ${rc.uidMasked}` : 'Enroll a physical NFC test card'} right={rc ? <Badge label={rc.status} tone={rc.status === 'ACTIVE' ? 'success' : 'warning'} /> : undefined} />
      </Card>

      <SectionHeader title="Connected credit cards" action={<Button title="Add" variant="ghost" icon="add" onPress={() => router.push('/connect-bank')} />} />
      {accounts.isLoading && <Loading />}
      {accounts.error && <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />}
      {accounts.data && credit.length === 0 && (
        <Card><EmptyState icon="card-outline" title="No credit cards connected" body="Connect your bank with Plaid to see your existing cards here." action={<Button title="Connect a bank" onPress={() => router.push('/connect-bank')} />} /></Card>
      )}
      {credit.length > 0 && (
        <Card>
          {credit.map((a) => (
            <AccountRow key={a.id} account={a} onPress={() => router.push(`/accounts/${a.id}`)} />
          ))}
        </Card>
      )}
      {credit.some((a) => a.connectionStatus !== 'ACTIVE') && <ConnectionBadge status="LOGIN_REQUIRED" />}

      {other.length > 0 && (
        <>
          <SectionHeader title="Other accounts" />
          <Card>{other.map((a) => <AccountRow key={a.id} account={a} onPress={() => router.push(`/accounts/${a.id}`)} />)}</Card>
        </>
      )}
      <Button title="Browse seeded card products" variant="secondary" icon="search-outline" onPress={() => router.push('/card-products')} />
    </Screen>
  );
}
