import { useState } from 'react';
import { Alert } from 'react-native';
import { formatCents, parseDollarsToCents, type MockFundingKind } from '@reclaimed/shared';
import { useMockFunding, useMutations, useReclaimedCards } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorState, KeyValue, Loading, Row, Screen, SectionHeader, Segmented, TestModeBanner, Text, TextField } from '@/components/ui';

export default function Funding() {
  const q = useMockFunding();
  const cards = useReclaimedCards();
  const m = useMutations();
  const [name, setName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [kind, setKind] = useState<MockFundingKind>('CREDIT');
  const [amount, setAmount] = useState('2000');

  const create = () => {
    const cents = parseDollarsToCents(amount);
    if (!name.trim() || cents === null) return Alert.alert('Check the form', 'Enter a name and a valid amount.');
    m.createFunding.mutate({ displayName: name.trim(), fictionalIssuer: issuer.trim() || name.trim(), kind, limitOrBalanceCents: cents }, {
      onSuccess: () => { setName(''); setIssuer(''); },
      onError: (e) => Alert.alert('Could not create', errorMessage(e)),
    });
  };
  const stageBalance = (id: string, current: number) =>
    Alert.prompt?.('Set simulated balance', 'Developer control for insufficient-funds tests (dollars).', (v) => {
      const c = parseDollarsToCents(v ?? '');
      if (c !== null) m.updateFunding.mutate({ id, currentBalanceCents: c });
    }, 'plain-text', String(current / 100)) ?? Alert.alert('Not supported', 'Use the iOS app or the API to stage balances on this platform.');

  return (
    <Screen edges={[]} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <TestModeBanner text="Fictional accounts for the simulator. Separate from your Plaid balances." />
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} />}
      {q.data?.length === 0 && (
        <Card><EmptyState icon="wallet-outline" title="No mock accounts" body="Create the demo set (Mock Citi, Mock Chase, Mock Checking) or add your own." action={<Button title="Create demo accounts" loading={m.demoSetup.isPending} onPress={() => m.demoSetup.mutate(cards.data?.[0]?.id)} />} /></Card>
      )}
      {q.data?.map((f) => (
        <Card key={f.id}>
          <Row><Text variant="heading">{f.displayName}</Text><Badge label={`Priority ${f.priority}`} tone="neutral" /></Row>
          <Text variant="caption" muted>{f.fictionalIssuer}{f.cardProduct ? ` · linked to ${f.cardProduct.productName}` : ''} · {f.kind === 'CREDIT' ? 'Credit' : 'Deposit'}</Text>
          {f.kind === 'CREDIT' && <KeyValue label="Credit limit" value={formatCents(f.creditLimitCents)} />}
          <KeyValue label={f.kind === 'CREDIT' ? 'Balance owed' : 'Balance'} value={formatCents(f.currentBalanceCents)} />
          <KeyValue label="Pending holds" value={formatCents(f.pendingHoldsCents)} />
          <KeyValue label="Available" value={formatCents(f.availableCents)} />
          <Row>
            <Badge label={f.status} tone={f.status === 'ACTIVE' ? 'success' : 'warning'} />
            <Button title="Stage balance" variant="ghost" onPress={() => stageBalance(f.id, f.currentBalanceCents)} />
            <Button title={f.status === 'ACTIVE' ? 'Suspend' : 'Activate'} variant="ghost" onPress={() => m.updateFunding.mutate({ id: f.id, status: f.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })} />
          </Row>
        </Card>
      ))}
      <SectionHeader title="Add a mock account" />
      <Card>
        <TextField label="Display name" value={name} onChangeText={setName} placeholder="Mock Amex" />
        <TextField label="Fictional issuer" value={issuer} onChangeText={setIssuer} placeholder="Mock Amex (fictional)" />
        <Segmented<MockFundingKind> value={kind} onChange={setKind} options={[{ value: 'CREDIT', label: 'Credit' }, { value: 'DEPOSIT', label: 'Deposit' }]} />
        <TextField label={kind === 'CREDIT' ? 'Credit limit ($)' : 'Starting balance ($)'} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
        <Button title="Create" onPress={create} loading={m.createFunding.isPending} />
      </Card>
    </Screen>
  );
}
