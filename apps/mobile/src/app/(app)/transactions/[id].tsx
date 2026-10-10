import { useLocalSearchParams } from 'expo-router';
import { formatCents } from '@reclaimed/shared';
import { useSimulatedTransaction } from '@/lib/queries';
import { Badge, Card, ErrorState, KeyValue, Loading, Row, Screen, SectionHeader, TestModeBanner, Text } from '@/components/ui';
import { PaymentStateBadge } from '@/components/finance';

export default function SimulatedTransaction() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useSimulatedTransaction(id);
  if (q.isLoading) return <Screen edges={[]}><Loading /></Screen>;
  if (!q.data) return <Screen edges={[]}><ErrorState error={q.error} /></Screen>;
  const { transaction: t, authorization: a, ledger } = q.data;
  return (
    <Screen edges={[]} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <TestModeBanner text="Simulated transaction — no real card was charged" />
      <Card>
        <Text variant="caption" muted>{t.reference}</Text>
        <Text variant="title">{t.merchantName}</Text>
        <Text variant="hero">{formatCents(t.amountCents)}</Text>
        <PaymentStateBadge state={t.state} />
        <KeyValue label="Merchant ID" value={t.merchantId} />
        <KeyValue label="MCC" value={t.mcc} />
        <KeyValue label="Funding (mock)" value={t.fundingAccountName ?? '—'} />
        <KeyValue label="Captured" value={formatCents(t.capturedCents)} />
        <KeyValue label="Refunded" value={formatCents(t.refundedCents)} />
        <KeyValue label="Processor" value={t.processor} />
        <KeyValue label="Time" value={new Date(t.createdAt).toLocaleString()} />
      </Card>
      {a && (
        <>
          <SectionHeader title="Authorization" />
          <Card>
            <Row><Text>Result</Text><Badge label={a.result} tone={a.result === 'APPROVED' ? 'success' : 'danger'} /></Row>
            {a.declineReason && <KeyValue label="Reason" value={a.declineReason} />}
            <KeyValue label="Total latency" value={`${a.latency.totalMs} ms`} />
            <Text variant="caption" muted>db {a.latency.dbLookupMs} ms · funding {a.latency.fundingEvaluationMs} ms · processor {a.latency.processorMs} ms</Text>
            {a.fundingAttempts.map((f) => <KeyValue key={f.sequence} label={`${f.sequence}. ${f.fundingAccountName}`} value={<Badge label={f.result} tone={f.result === 'APPROVED' ? 'success' : 'danger'} />} />)}
          </Card>
        </>
      )}
      <SectionHeader title="Ledger (double-entry)" />
      {ledger.map((j) => (
        <Card key={j.id}>
          <Text variant="label">{j.journalType.replace(/_/g, ' ')}</Text>
          <Text variant="caption" muted>{j.description}</Text>
          {j.entries.map((e, i) => (
            <Row key={i}>
              <Text variant="caption" style={{ flex: 1 }}>{e.direction === 'DEBIT' ? 'Dr' : 'Cr'} {e.ledgerAccountCode}</Text>
              <Text variant="caption">{formatCents(e.amountCents)}</Text>
            </Row>
          ))}
        </Card>
      ))}
    </Screen>
  );
}
