import { Redirect } from 'expo-router';
import { useHardwareStatus } from '@/lib/queries';
import { env } from '@/lib/env';
import { Badge, Card, EmptyState, ErrorState, KeyValue, ListItem, Loading, Screen, SectionHeader, Text } from '@/components/ui';
import { formatCents } from '@reclaimed/shared';

/** Available only in development builds (__DEV__ or EXPO_PUBLIC_ENABLE_DEV_TOOLS). */
export default function DevHardware() {
  const q = useHardwareStatus();
  if (!env.devTools) return <Redirect href="/" />;
  const s = q.data;
  return (
    <Screen edges={[]} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {s && (
        <>
          <Card>
            <KeyValue label="Hardware bridge" value={<Badge label={s.bridgeConnected ? 'Online' : 'Offline'} tone={s.bridgeConnected ? 'success' : 'danger'} />} />
            <KeyValue label="Processor" value={s.paymentMode} />
            <KeyValue label="Lithic Sandbox" value={s.lithic.configured ? `Configured (${s.lithic.environment}${s.lithic.asaEnabled ? ', ASA on' : ''})` : 'Not configured'} />
          </Card>
          <SectionHeader title="Readers" />
          <Card>
            {s.readers.length === 0 && <EmptyState icon="hardware-chip-outline" title="No reader has reported" body="Run npm run dev:hardware with the ACR1252U plugged in." />}
            {s.readers.map((r) => (
              <Card key={r.id} style={{ padding: 0, borderWidth: 0 }}>
                <Text variant="heading">{r.model ?? 'Unknown model'}</Text>
                <Text variant="caption" muted>{r.readerName}</Text>
                <KeyValue label="Connection" value={<Badge label={r.connected ? 'Connected' : 'Disconnected'} tone={r.connected ? 'success' : 'danger'} />} />
                <KeyValue label="Last detection" value={r.lastCardPresentAt ? new Date(r.lastCardPresentAt).toLocaleTimeString() : '—'} />
                <KeyValue label="Last card" value={`${r.lastUidMasked ?? '—'} ${r.lastCardType ?? ''}`} />
                <KeyValue label="Card presence" value={r.lastCardPresentAt && (!r.lastCardRemovedAt || r.lastCardPresentAt > r.lastCardRemovedAt) ? 'Present' : 'None'} />
                {r.lastError && <Text variant="caption" muted>Last error: {r.lastError}</Text>}
              </Card>
            ))}
          </Card>
          <SectionHeader title="Current terminal checkout" />
          <Card>
            {s.pendingCheckout ? <KeyValue label={`${s.pendingCheckout.merchantName} ${s.pendingCheckout.reference}`} value={`${formatCents(s.pendingCheckout.amountCents)} · ${s.pendingCheckout.state}`} /> : <Text muted>No checkout waiting.</Text>}
          </Card>
          <SectionHeader title="Latest authorization" />
          <Card>
            {s.latestAuthorization ? (
              <>
                <KeyValue label="Result" value={<Badge label={s.latestAuthorization.result} tone={s.latestAuthorization.result === 'APPROVED' ? 'success' : 'danger'} />} />
                <KeyValue label="Latency" value={`${s.latestAuthorization.latency.totalMs} ms`} />
                {s.latestAuthorization.fundingAttempts.map((f) => <KeyValue key={f.sequence} label={f.fundingAccountName} value={f.result} />)}
              </>
            ) : <Text muted>None yet.</Text>}
          </Card>
          <SectionHeader title="Recent taps" />
          <Card>
            {s.recentTaps.length === 0 && <Text muted>No taps recorded.</Text>}
            {s.recentTaps.map((t) => <ListItem key={t.id} icon="radio-outline" title={`${t.uidMasked} · ${t.outcome}`} subtitle={`${new Date(t.createdAt).toLocaleTimeString()} · ${t.cardType ?? 'card'}`} />)}
          </Card>
          <SectionHeader title="Diagnostic events" />
          <Card>
            {s.recentEvents.filter((e) => e.type === 'READER_ERROR' || e.type.startsWith('READER')).slice(0, 10).map((e, i) => (
              <ListItem key={i} icon={e.type === 'READER_ERROR' ? 'warning-outline' : 'pulse-outline'} title={e.type} subtitle={`${new Date(e.occurredAt).toLocaleTimeString()} · ${JSON.stringify(e.detail ?? {})}`} />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
