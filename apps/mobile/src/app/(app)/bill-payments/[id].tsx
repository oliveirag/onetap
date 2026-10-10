import { useLocalSearchParams } from 'expo-router';
import { formatCents } from '@reclaimed/shared';
import { useBillPayment, useMutations } from '@/lib/queries';
import { Button, Card, ErrorState, KeyValue, ListItem, Loading, Screen, SectionHeader, TestModeBanner, Text } from '@/components/ui';
import { BillStateBadge } from '@/components/finance';

export default function BillPaymentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useBillPayment(id);
  const m = useMutations();
  if (q.isLoading) return <Screen edges={[]}><Loading /></Screen>;
  if (!q.data) return <Screen edges={[]}><ErrorState error={q.error} /></Screen>;
  const p = q.data;
  return (
    <Screen edges={[]} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <TestModeBanner />
      <Card>
        <Text variant="hero">{formatCents(p.amountCents)}</Text>
        <BillStateBadge state={p.state} />
        <KeyValue label="To" value={p.financialAccountName ?? 'Card'} />
        <KeyValue label="From" value={p.fundingAccountName ?? 'Mock account'} />
        <KeyValue label="Created" value={new Date(p.createdAt).toLocaleString()} />
        {p.failureReason && <KeyValue label="Reason" value={p.failureReason.replace(/_/g, ' ').toLowerCase()} />}
        {p.state === 'COMPLETED' && <Text variant="caption" muted>Completed in simulation only — no issuer received money.</Text>}
      </Card>
      {(p.state === 'DRAFT' || p.state === 'SUBMITTED') && (
        <Button title="Cancel payment" variant="danger" loading={m.cancelBillPayment.isPending} onPress={() => m.cancelBillPayment.mutate(p.id)} />
      )}
      {m.cancelBillPayment.error && <ErrorState error={m.cancelBillPayment.error} />}
      <SectionHeader title="Status history" />
      <Card>
        {p.events.map((e, i) => <ListItem key={i} icon="ellipse-outline" title={e.state} subtitle={`${new Date(e.createdAt).toLocaleTimeString()}${e.note ? ` · ${e.note}` : ''}`} />)}
      </Card>
    </Screen>
  );
}
