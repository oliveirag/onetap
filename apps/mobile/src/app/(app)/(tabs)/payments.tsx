import { router } from 'expo-router';
import { formatCents } from '@reclaimed/shared';
import { useBillPayAccounts, useBillPayments } from '@/lib/queries';
import { Button, Card, EmptyState, ErrorState, KeyValue, ListItem, Loading, Money, Row, Screen, SectionHeader, TestModeBanner, Text } from '@/components/ui';
import { BillStateBadge } from '@/components/finance';

export default function Payments() {
  const accounts = useBillPayAccounts();
  const history = useBillPayments();
  return (
    <Screen refreshing={accounts.isRefetching} onRefresh={() => { void accounts.refetch(); void history.refetch(); }}>
      <Text variant="title">Payments</Text>
      <TestModeBanner />
      <SectionHeader title="Credit card balances" />
      {accounts.isLoading && <Loading />}
      {accounts.error && <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />}
      {accounts.data?.length === 0 && <Card><EmptyState icon="card-outline" title="No credit cards connected" body="Connect a bank to see reported balances and due dates." /></Card>}
      {accounts.data?.map(({ account, liability }) => (
        <Card key={account.id}>
          <Row>
            <Text variant="heading" numberOfLines={1} style={{ flex: 1 }}>{account.name}{account.mask ? ` ••${account.mask}` : ''}</Text>
            <Money cents={account.currentBalanceCents} variant="heading" />
          </Row>
          <Text variant="caption" muted>{account.institutionName} · reported current balance</Text>
          <KeyValue label="Statement balance" value={liability?.lastStatementBalanceCents != null ? formatCents(liability.lastStatementBalanceCents) : 'Not available'} />
          <KeyValue label="Minimum payment" value={liability?.minimumPaymentCents != null ? formatCents(liability.minimumPaymentCents) : 'Not available'} />
          <KeyValue label="Due date" value={liability?.nextPaymentDueDate ?? 'Not available'} />
          <Button title="Pay card (test mode)" icon="send-outline" onPress={() => router.push(`/pay/${account.id}`)} />
        </Card>
      ))}
      <SectionHeader title="Test repayment history" />
      <Card>
        {history.data?.items.length ? history.data.items.map((p) => (
          <ListItem key={p.id} icon="swap-horizontal-outline" title={`${formatCents(p.amountCents)} to ${p.financialAccountName ?? 'card'}`} subtitle={`${new Date(p.createdAt).toLocaleString()} · from ${p.fundingAccountName ?? 'mock account'}`} right={<BillStateBadge state={p.state} />} onPress={() => router.push(`/bill-payments/${p.id}`)} />
        )) : <EmptyState icon="time-outline" title="No test payments yet" />}
      </Card>
    </Screen>
  );
}
