import type { ReactElement } from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/lib/theme';
import { AuthProvider } from '@/lib/auth';
import { api } from '@/lib/api';

type Handler = (body: unknown) => unknown;
export type Routes = Record<string, unknown | Handler>;

/** Routes keyed by "METHOD /path" (query string ignored). Unmatched calls throw. */
export function mockApi(routes: Routes) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  (api as jest.Mock).mockImplementation(async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const key = `${method} ${path.split('?')[0]}`;
    if (!(key in routes)) throw new Error(`Unmocked API call: ${key}`);
    const r = routes[key];
    return typeof r === 'function' ? (r as Handler)(body) : r;
  });
  return calls;
}

export function renderScreen(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <AuthProvider>{ui}</AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

export const fixtures = {
  product: { id: 'p-dc', issuerName: 'Citi', productName: 'Citi Double Cash', productSlug: 'citi-double-cash', cardNetwork: 'MASTERCARD' },
  account: (o: object = {}) => ({
    id: 'a1', plaidItemId: 'i1', institutionName: 'Citibank Online', name: 'Citi Double Cash Card', officialName: null, mask: '4321', type: 'credit', subtype: 'credit card',
    currentBalanceCents: 41055, availableBalanceCents: 458945, creditLimitCents: 500000, isoCurrencyCode: 'USD', balanceUpdatedAt: '2026-10-10T10:00:00Z',
    connectionStatus: 'ACTIVE', cardProduct: null, cardProductConfirmed: false, ...o,
  }),
  simTxn: (o: object = {}) => ({
    id: 't1', reference: 'RCL-20261010-ABC123', terminalId: 'term', merchantId: 'MID-WALMART-0001', merchantName: 'Walmart', mcc: '5310', amountCents: 10000, currency: 'USD',
    state: 'AUTHORIZED', authorizationResult: 'APPROVED', declineReason: null, reclaimedCardId: 'c1', fundingAccountId: 'f1', fundingAccountName: 'Mock Citi',
    capturedCents: 0, refundedCents: 0, processor: 'mock', expiresAt: '2026-10-10T10:01:00Z', createdAt: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:00:00Z', simulated: true, ...o,
  }),
  bankTxn: { id: 'b1', financialAccountId: 'a1', accountName: 'Citi Double Cash Card', name: 'COFFEE SHOP', merchantName: 'Coffee Shop', amountCents: 1234, isoCurrencyCode: 'USD', date: '2026-10-01', pending: false, category: null },
  card: (o: object = {}) => ({
    id: 'c1', displayId: 'RC-7F3A-19C2', nickname: null, status: 'ACTIVE', uidMasked: '••••E5F6', cardTechnology: 'MIFARE Classic 1K', primaryFundingAccountId: 'f1',
    secondaryFundingAccountId: 'f2', fallbackEnabled: true, perTransactionLimitCents: 100000, dailyLimitCents: 250000, enrolledAt: '2026-10-10T09:00:00Z', lastTappedAt: null, lithicSandboxMapped: false, ...o,
  }),
  funding: [
    { id: 'f1', displayName: 'Mock Citi', fictionalIssuer: 'Mock Citi (fictional)', kind: 'CREDIT', cardProduct: null, creditLimitCents: 200000, currentBalanceCents: 0, pendingHoldsCents: 0, availableCents: 200000, status: 'ACTIVE', priority: 1 },
    { id: 'f2', displayName: 'Mock Chase', fictionalIssuer: 'Mock Chase (fictional)', kind: 'CREDIT', cardProduct: null, creditLimitCents: 500000, currentBalanceCents: 0, pendingHoldsCents: 0, availableCents: 500000, status: 'ACTIVE', priority: 2 },
  ],
  hardware: { readers: [{ id: 'r1', readerName: 'ACS ACR1252 1S CL Reader PICC 0', bridgeId: 'b', model: 'ACS ACR1252U', connected: true, lastSeenAt: null, lastCardPresentAt: null, lastCardRemovedAt: null, lastCardType: null, lastUidMasked: null, lastError: null }], bridgeConnected: true, recentTaps: [], recentEvents: [], paymentMode: 'mock', lithic: { configured: false, environment: null, asaEnabled: false }, pendingCheckout: null, latestAuthorization: null },
};
