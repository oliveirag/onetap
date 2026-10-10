import { useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { formatCents, parseDollarsToCents, type BillPaymentScenario } from '@reclaimed/shared';
import { useAccount, useLiability, useMockFunding, useMutations } from '@/lib/queries';
import { env } from '@/lib/env';
import { Button, Card, ErrorState, KeyValue, ListItem, Loading, Screen, SectionHeader, Segmented, TestModeBanner, Text, TextField, Badge } from '@/components/ui';

type Step = 'form' | 'review';

export default function PayCard() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const account = useAccount(accountId);
  const liability = useLiability(accountId);
  const funding = useMockFunding();
  const m = useMutations();
  const [fundingId, setFundingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [scenario, setScenario] = useState<BillPaymentScenario>('SUCCESS');
  const [step, setStep] = useState<Step>('form');
  const cents = parseDollarsToCents(amount);
  const source = useMemo(() => funding.data?.find((f) => f.id === fundingId) ?? null, [funding.data, fundingId]);
  const amountError = amount && (cents === null || cents < 100) ? 'Enter at least $1.00.' : source && cents && cents > source.availableCents ? `Exceeds ${source.displayName}'s simulated available funds.` : undefined;

  if (account.isLoading) return <Screen edges={[]}><Loading /></Screen>;
  const a = account.data;
  const l = liability.data;
  const quick = [
    l?.minimumPaymentCents != null ? { label: 'Minimum', cents: l.minimumPaymentCents } : null,
    l?.lastStatementBalanceCents != null ? { label: 'Statement', cents: l.lastStatementBalanceCents } : null,
    a?.currentBalanceCents != null && a.currentBalanceCents > 0 ? { label: 'Current', cents: a.currentBalanceCents } : null,
  ].filter((x): x is { label: string; cents: number } => Boolean(x));

  return (
    <Screen edges={['bottom']}>
      <TestModeBanner />
      <Card>
        <Text variant="heading">{a?.name}{a?.mask ? ` ••${a.mask}` : ''}</Text>
        <KeyValue label="Reported current balance" value={formatCents(a?.currentBalanceCents)} />
        <KeyValue label="Statement balance" value={l?.lastStatementBalanceCents != null ? formatCents(l.lastStatementBalanceCents) : 'Not available'} />
        <KeyValue label="Minimum payment" value={l?.minimumPaymentCents != null ? formatCents(l.minimumPaymentCents) : 'Not available'} />
        <KeyValue label="Due date" value={l?.nextPaymentDueDate ?? 'Not available'} />
      </Card>

      {step === 'form' ? (
        <>
          <SectionHeader title="Pay from (mock account)" />
          <Card>
            {funding.data?.length === 0 && <Text muted>Create a mock funding account first (Settings → Mock funding accounts).</Text>}
            {funding.data?.map((f) => (
              <ListItem key={f.id} icon={f.id === fundingId ? 'radio-button-on' : 'radio-button-off'} title={f.displayName} subtitle={`${formatCents(f.availableCents)} available · fictional`} onPress={() => setFundingId(f.id)} testID={`funding-${f.displayName}`} />
            ))}
          </Card>
          <TextField label="Amount (USD)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0.00" error={amountError} testID="amount" />
          {quick.length > 0 && <Segmented value="" onChange={(v) => setAmount((Number(v) / 100).toFixed(2))} options={quick.map((q) => ({ value: String(q.cents), label: `${q.label} ${formatCents(q.cents)}` })) as { value: string; label: string }[]} />}
          {env.devTools && (
            <>
              <Text variant="caption" muted>Simulation outcome (development)</Text>
              <Segmented<BillPaymentScenario> value={scenario} onChange={setScenario} options={[{ value: 'SUCCESS', label: 'Succeeds' }, { value: 'FAIL', label: 'Fails' }, { value: 'RETURN', label: 'Returned' }]} />
            </>
          )}
          <Button title="Review payment" disabled={!fundingId || !cents || Boolean(amountError)} onPress={() => setStep('review')} testID="review" />
        </>
      ) : (
        <>
          <Card>
            <Text variant="label" muted>REVIEW</Text>
            <KeyValue label="Pay" value={formatCents(cents)} />
            <KeyValue label="To" value={a?.name ?? 'card'} />
            <KeyValue label="From" value={source?.displayName ?? ''} />
            {scenario !== 'SUCCESS' && <Badge label={`Simulating: ${scenario}`} tone="warning" />}
            <Text variant="caption" muted>This is a simulated payment. No ACH transfer or issuer payment is made, and your Plaid-reported balance will not change.</Text>
          </Card>
          {m.createBillPayment.error && <ErrorState error={m.createBillPayment.error} />}
          <Button title="Confirm test payment" loading={m.createBillPayment.isPending} testID="confirm"
            onPress={() => cents && fundingId && m.createBillPayment.mutate({ financialAccountId: accountId, fundingAccountId: fundingId, amountCents: cents, confirm: true, scenario }, { onSuccess: (p) => router.replace(`/bill-payments/${p.id}`) })} />
          <Button title="Back" variant="ghost" onPress={() => setStep('form')} />
        </>
      )}
    </Screen>
  );
}
