import { useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useMe, useMutations, usePlaidItems } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/api';
import { Badge, Button, Card, ErrorState, ListItem, Screen, SectionHeader, Segmented, Text, TextField } from '@/components/ui';

export default function Settings() {
  const me = useMe();
  const items = usePlaidItems();
  const m = useMutations();
  const { signOut } = useAuth();
  const { preference, setPreference } = useTheme();
  const [name, setName] = useState<string | null>(null);

  const changeTheme = (p: ThemePreference) => {
    setPreference(p);
    m.updateProfile.mutate({ themePreference: p });
  };

  const confirmDelete = () =>
    Alert.alert('Delete account?', 'This permanently deletes your Reclaimed account, disconnects your banks from Plaid and revokes your test card. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => m.deleteAccount.mutate(undefined, { onSuccess: () => void signOut(), onError: (e) => Alert.alert('Could not delete', errorMessage(e)) }) },
    ]);

  return (
    <Screen>
      <Text variant="title">Settings</Text>
      <SectionHeader title="Profile" />
      <Card>
        {me.error && <ErrorState error={me.error} />}
        <TextField label="Full name" value={name ?? me.data?.fullName ?? ''} onChangeText={setName} />
        <Text variant="caption" muted>{me.data?.email}</Text>
        <Button title="Save" variant="secondary" disabled={name === null} loading={m.updateProfile.isPending} onPress={() => name !== null && m.updateProfile.mutate({ fullName: name }, { onSuccess: () => setName(null) })} />
      </Card>

      <SectionHeader title="Connected institutions" action={<Button title="Add" variant="ghost" icon="add" onPress={() => router.push('/connect-bank')} />} />
      <Card>
        {items.data?.length === 0 && <Text muted>No institutions connected.</Text>}
        {items.data?.map((i) => (
          <Card key={i.id} style={{ padding: 0, borderWidth: 0 }}>
            <ListItem icon="business-outline" title={i.institutionName ?? 'Institution'} subtitle={`${i.accountCount} account(s) · ${i.lastSyncedAt ? `synced ${new Date(i.lastSyncedAt).toLocaleString()}` : 'never synced'}`} right={<Badge label={i.status === 'ACTIVE' ? 'Connected' : i.status === 'LOGIN_REQUIRED' ? 'Reconnect' : i.status} tone={i.status === 'ACTIVE' ? 'success' : 'warning'} />} />
            <Button title={i.status === 'LOGIN_REQUIRED' ? 'Reconnect' : 'Sync now'} variant="ghost" loading={m.syncItem.isPending && m.syncItem.variables === i.id}
              onPress={() => i.status === 'LOGIN_REQUIRED' ? router.push({ pathname: '/connect-bank', params: { itemId: i.id } }) : m.syncItem.mutate(i.id, { onError: (e) => Alert.alert('Sync failed', errorMessage(e)) })} />
            <Button title="Disconnect" variant="danger" onPress={() => Alert.alert('Disconnect institution?', `Remove ${i.institutionName ?? 'this institution'} and its imported data from Reclaimed?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Disconnect', style: 'destructive', onPress: () => m.removeItem.mutate(i.id) },
            ])} />
          </Card>
        ))}
      </Card>

      <SectionHeader title="Appearance" />
      <Segmented<ThemePreference> value={preference} onChange={changeTheme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />

      <SectionHeader title="Reclaimed" />
      <Card>
        <ListItem icon="wallet-outline" title="Mock funding accounts" subtitle="Fictional accounts used by the payment simulator" onPress={() => router.push('/funding')} />
        {env.devTools && <ListItem icon="hardware-chip-outline" title="Developer hardware" subtitle="Reader, taps, authorizations, processor status" onPress={() => router.push('/dev-hardware')} testID="dev-hardware-link" />}
      </Card>

      <Button title="Log out" variant="secondary" icon="log-out-outline" onPress={() => void signOut()} />
      <Button title="Delete account" variant="danger" loading={m.deleteAccount.isPending} onPress={confirmDelete} />
      <Text variant="caption" muted style={{ textAlign: 'center' }}>Reclaimed Phase 1 prototype · Simulation and sandbox only · No live money movement</Text>
    </Screen>
  );
}
