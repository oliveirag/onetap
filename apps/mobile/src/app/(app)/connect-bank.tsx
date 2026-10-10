import { useState } from 'react';
import { Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutations } from '@/lib/queries';
import { openPlaidLink } from '@/lib/plaid';
import { Button, Card, ErrorState, Screen, Text } from '@/components/ui';

export default function ConnectBank() {
  const { itemId } = useLocalSearchParams<{ itemId?: string }>();
  const m = useMutations();
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const { linkToken } = await m.linkToken.mutateAsync(itemId);
      setStatus('Opening Plaid…');
      const result = await openPlaidLink(linkToken);
      if (result.kind === 'exit') {
        setStatus(result.message ?? 'Plaid closed before finishing.');
        return;
      }
      if (itemId) {
        await m.syncItem.mutateAsync(itemId);
        setStatus('Connection repaired.');
      } else {
        setStatus('Importing your accounts…');
        const r = await m.exchange.mutateAsync({ publicToken: result.publicToken, institution: result.institution });
        setStatus(`Imported ${r.accountsImported} account(s).`);
      }
      setTimeout(() => router.back(), 800);
    } catch (e) {
      setError(e);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Text variant="title">{itemId ? 'Reconnect institution' : 'Connect your bank'}</Text>
      <Text muted>Reclaimed uses Plaid to securely read your existing credit cards, balances, transactions and statement details. Your bank credentials go to Plaid, never to Reclaimed.</Text>
      <Card>
        <Text variant="label" muted>SANDBOX</Text>
        <Text>In Plaid Sandbox, pick any institution and sign in with user_good / pass_good.</Text>
      </Card>
      {Platform.OS === 'web' && <Text muted>Plaid Link requires the iOS or Android development build.</Text>}
      {error ? <ErrorState error={error} /> : null}
      {status && <Text>{status}</Text>}
      <Button title={itemId ? 'Reconnect with Plaid' : 'Continue with Plaid'} onPress={start} loading={busy} disabled={Platform.OS === 'web'} testID="open-plaid" />
    </Screen>
  );
}
