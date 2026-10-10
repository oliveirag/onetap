import { router, useLocalSearchParams } from 'expo-router';
import { formatCents } from '@reclaimed/shared';
import { useAccount, useBankTransactions, useLiability } from '@/lib/queries';
import { Badge, Button, Card, EmptyState, ErrorState, KeyValue, Loading, Money, Screen, SectionHeader, Text } from '@/components/ui';
import { BankTxnRow, ConnectionBadge } from '@/components/finance';

export default function AccountDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = useAccount(id);
  const l = useLiability(id);
  const t = useBankTransactions({ accountId: id, limit: 20 });
  if (a.isLoading) return <Screen edges={[]}><Loading /></Screen>;
  if (a.error || !a.data) return <Screen edges={[]}><ErrorState error={a.error} onRetry={() => void a.refetch()} /></Screen>;
  const acct = a.data;
  return (
    <Screen edges={[]} refreshing={a.isRefetching} onRefresh={() => { void a.refetch(); void l.refetch(); void t.refetch(); }}>
      <Card>
        <Text variant="caption" muted>{acct.institutionName ?? 'Institution'}</Text>
        <Text variant="title">{acct.officialName ?? acct.name}</Text>
        <Text muted>{acct.mask ? `•••• ${acct.mask}` : 'Mask unavailable'}</Text>
        <ConnectionBadge status={acct.connectionStatus} />
        <KeyValue label="Current balance" value={<Money cents={acct.currentBalanceCents} variant="heading" />} />
        <KeyValue label="Available credit" value={formatCents(acct.availableBalanceCents)} />
        <KeyValue label="Credit limit" value={formatCents(acct.creditLimitCents)} />
        <Text variant="caption" muted>Reported by Plaid{acct.balanceUpdatedAt ? ` · updated ${new Date(acct.balanceUpdatedAt).toLocaleString()}` : ''}. May not be real-time.</Text>
      </Card>

      {acct.type === 'credit' && (
        <Card>
          <Text variant="label" muted>CARD PRODUCT</Text>
          {acct.cardProduct ? (
            <>
              <Text variant="heading">{acct.cardProduct.productName}</Text>
              <Text muted>{acct.cardProduct.issuerName} · {acct.cardProduct.cardNetwork}</Text>
              <Badge label={acct.cardProductConfirmed ? 'Confirmed by you' : 'Suggested — please confirm'} tone={acct.cardProductConfirmed ? 'success' : 'warning'} />
            </>
          ) : (
            <Text muted>Exact product unconfirmed.</Text>
          )}
          <Button title={acct.cardProduct ? 'Change or confirm product' : 'Identify card product'} variant="secondary" onPress={() => router.push(`/accounts/product/${acct.id}`)} />
        </Card>
      )}

      {acct.type === 'credit' && (
        <Card>
          <Text variant="label" muted>STATEMENT</Text>
          {l.isLoading ? <Loading /> : l.data ? (
            <>
              <KeyValue label="Statement balance" value={formatCents(l.data.lastStatementBalanceCents)} />
              <KeyValue label="Minimum payment" value={formatCents(l.data.minimumPaymentCents)} />
              <KeyValue label="Due date" value={l.data.nextPaymentDueDate ?? '—'} />
              <KeyValue label="Statement date" value={l.data.lastStatementIssueDate ?? '—'} />
              {l.data.aprs.map((apr) => <KeyValue key={apr.aprType} label={`APR (${apr.aprType.replace(/_/g, ' ')})`} value={`${apr.aprPercentage}%`} />)}
              {l.data.isOverdue && <Badge label="Overdue" tone="danger" />}
            </>
          ) : <Text muted>Statement details are not available for this account.</Text>}
          <Button title="Pay card (test mode)" onPress={() => router.push(`/pay/${acct.id}`)} />
        </Card>
      )}

      <SectionHeader title="Recent transactions" />
      <Card>
        {t.isLoading ? <Loading /> : t.data?.items.length ? t.data.items.map((x) => <BankTxnRow key={x.id} t={x} />) : <EmptyState title="No transactions yet" />}
      </Card>
    </Screen>
  );
}
