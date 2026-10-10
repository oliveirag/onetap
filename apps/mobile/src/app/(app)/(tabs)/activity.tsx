import { useState } from 'react';
import { router } from 'expo-router';
import { useBankTransactions, useSimulatedTransactions } from '@/lib/queries';
import { Card, EmptyState, ErrorState, Loading, Screen, Segmented, Text, TextField } from '@/components/ui';
import { BankTxnRow, SimTxnRow } from '@/components/finance';

type Tab = 'simulated' | 'bank';

export default function Activity() {
  const [tab, setTab] = useState<Tab>('simulated');
  const [search, setSearch] = useState('');
  const sim = useSimulatedTransactions({ search, limit: 50 });
  const bank = useBankTransactions({ search, limit: 50 });
  const q = tab === 'simulated' ? sim : bank;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Text variant="title">Activity</Text>
      <Segmented<Tab> value={tab} onChange={setTab} options={[{ value: 'simulated', label: 'Reclaimed (simulated)' }, { value: 'bank', label: 'Bank (Plaid)' }]} />
      <TextField label="Search" placeholder={tab === 'simulated' ? 'Merchant or reference' : 'Merchant or description'} value={search} onChangeText={setSearch} autoCapitalize="none" />
      <Text variant="caption" muted>
        {tab === 'simulated'
          ? 'Simulated Reclaimed transactions use fictional funding accounts. They are never real bank spending.'
          : 'Transactions reported by your institutions through Plaid. Data may be delayed.'}
      </Text>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      <Card>
        {tab === 'simulated' && sim.data && (sim.data.items.length ? sim.data.items.map((t) => <SimTxnRow key={t.id} t={t} onPress={() => router.push(`/transactions/${t.id}`)} />) : <EmptyState title="No simulated transactions" body={search ? 'No matches for your search.' : 'Tap your Reclaimed card at the test terminal to create one.'} />)}
        {tab === 'bank' && bank.data && (bank.data.items.length ? bank.data.items.map((t) => <BankTxnRow key={t.id} t={t} />) : <EmptyState title="No bank transactions" body={search ? 'No matches for your search.' : 'Connect a bank and wait for Plaid to sync.'} />)}
      </Card>
    </Screen>
  );
}
