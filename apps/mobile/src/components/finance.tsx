import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { BankTransactionDto, FinancialAccountDto, PaymentState, ReclaimedCardDto, SimulatedTransactionDto, BillPaymentState } from '@reclaimed/shared';
import { formatCents } from '@reclaimed/shared';
import { radius, spacing, useTheme } from '@/lib/theme';
import { Badge, ListItem, Money, Text } from './ui';

const STATE_TONE: Record<PaymentState, 'neutral' | 'success' | 'danger' | 'warning' | 'accent'> = {
  CREATED: 'neutral', AUTHORIZATION_PENDING: 'warning', AUTHORIZED: 'accent', DECLINED: 'danger', CAPTURED: 'accent',
  SETTLEMENT_PENDING: 'warning', SETTLED: 'success', REVERSED: 'neutral', PARTIALLY_REFUNDED: 'warning', REFUNDED: 'neutral', FAILED: 'danger',
};
const pretty = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function PaymentStateBadge({ state }: { state: PaymentState }) {
  return <Badge label={pretty(state)} tone={STATE_TONE[state]} />;
}

export function BillStateBadge({ state }: { state: BillPaymentState }) {
  const tone = state === 'COMPLETED' ? 'success' : state === 'FAILED' || state === 'RETURNED' ? 'danger' : state === 'CANCELED' ? 'neutral' : 'warning';
  return <Badge label={pretty(state)} tone={tone} />;
}

export function ConnectionBadge({ status }: { status: FinancialAccountDto['connectionStatus'] }) {
  if (status === 'ACTIVE') return <Badge label="Connected" tone="success" />;
  if (status === 'LOGIN_REQUIRED') return <Badge label="Reconnect needed" tone="warning" />;
  return <Badge label={pretty(status)} tone="danger" />;
}

export function AccountRow({ account, onPress }: { account: FinancialAccountDto; onPress?: () => void }) {
  const product = account.cardProduct ? `${account.cardProduct.productName}${account.cardProductConfirmed ? '' : ' (suggested)'}` : account.type === 'credit' ? 'Product unconfirmed' : pretty(account.subtype ?? account.type);
  return (
    <ListItem
      testID={`account-${account.id}`}
      icon={account.type === 'credit' ? 'card-outline' : 'business-outline'}
      title={`${account.name}${account.mask ? ` ••${account.mask}` : ''}`}
      subtitle={`${account.institutionName ?? 'Institution'} · ${product}`}
      right={<Money cents={account.currentBalanceCents} />}
      onPress={onPress}
    />
  );
}

export function BankTxnRow({ t }: { t: BankTransactionDto }) {
  const { colors } = useTheme();
  // Plaid: positive amounts are money out of the account.
  return (
    <ListItem
      icon="receipt-outline"
      title={t.merchantName ?? t.name}
      subtitle={`${t.date}${t.pending ? ' · Pending' : ''}${t.accountName ? ` · ${t.accountName}` : ''}`}
      right={<Money cents={-t.amountCents} signed color={t.amountCents < 0 ? colors.success : colors.text} />}
    />
  );
}

export function SimTxnRow({ t, onPress }: { t: SimulatedTransactionDto; onPress?: () => void }) {
  return (
    <ListItem
      testID={`sim-${t.id}`}
      icon="flash-outline"
      title={t.merchantName}
      subtitle={`${new Date(t.createdAt).toLocaleString()} · ${t.fundingAccountName ?? 'No funding'} · Simulated`}
      right={<View style={{ alignItems: 'flex-end', gap: 4 }}><Money cents={t.amountCents} /><PaymentStateBadge state={t.state} /></View>}
      onPress={onPress}
    />
  );
}

/** Visual for the physical Reclaimed test card. */
export function ReclaimedCardVisual({ card }: { card: ReclaimedCardDto | null }) {
  const { colors } = useTheme();
  const frozen = card?.status === 'FROZEN';
  return (
    <View
      accessibilityLabel={card ? `Reclaimed test card ${card.displayId}, ${card.status.toLowerCase()}` : 'No Reclaimed card enrolled'}
      style={{ backgroundColor: frozen ? '#334155' : colors.card, borderRadius: radius.lg, padding: spacing.xl, aspectRatio: 1.586, justifyContent: 'space-between' }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="heading" color={colors.cardText}>Reclaimed</Text>
        <Ionicons name={frozen ? 'snow-outline' : 'wifi-outline'} size={22} color={colors.cardText} style={{ transform: [{ rotate: frozen ? '0deg' : '90deg' }] }} />
      </View>
      <View style={{ gap: 4 }}>
        <Text variant="title" color={colors.cardText} style={{ letterSpacing: 2 }}>{card ? card.displayId : 'Not enrolled'}</Text>
        <Text variant="caption" color="#CBD5E1">{card ? `NFC ${card.uidMasked} · ${card.cardTechnology ?? 'Generic NFC'} · ${card.status}` : 'Tap a generic NFC card on the reader to enroll'}</Text>
        <Text variant="caption" color="#94A3B8">Development test card — not a payment credential</Text>
      </View>
    </View>
  );
}

export function FundingLine({ label, name, available }: { label: string; name: string | null; available?: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text muted>{label}</Text>
      <Text>{name ?? 'Not set'}{available !== undefined ? ` · ${formatCents(available)} avail.` : ''}</Text>
    </View>
  );
}
