import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Home from '@/app/(app)/(tabs)/index';
import Cards from '@/app/(app)/(tabs)/cards';
import Activity from '@/app/(app)/(tabs)/activity';
import Payments from '@/app/(app)/(tabs)/payments';
import Settings from '@/app/(app)/(tabs)/settings';
import AccountDetails from '@/app/(app)/accounts/[id]';
import ReclaimedCardScreen from '@/app/(app)/reclaimed-card';
import Enroll from '@/app/(app)/enroll';
import ConnectBank from '@/app/(app)/connect-bank';
import ConfirmProduct from '@/app/(app)/accounts/product/[id]';
import { fixtures, mockApi, renderScreen } from './utils';

beforeEach(() => jest.clearAllMocks());

describe('Home dashboard', () => {
  it('keeps real (Plaid) and simulated data in separate sections', async () => {
    mockApi({
      'GET /dashboard/summary': {
        real: { connectedCreditCards: 2, totalKnownCreditBalanceCents: 51054, institutions: [{ id: 'i1', name: 'Citi', status: 'ACTIVE', lastSyncedAt: null }], recentTransactions: [fixtures.bankTxn], lastSyncedAt: null },
        simulated: { reclaimedCard: fixtures.card(), recentTransactions: [fixtures.simTxn()], mockFundingAccounts: fixtures.funding },
      },
      'GET /hardware/status': fixtures.hardware,
    });
    await renderScreen(<Home />);
    expect(await screen.findByText('$510.54')).toBeTruthy();
    expect(screen.getByText('REPORTED BY YOUR BANKS (PLAID)')).toBeTruthy();
    expect(screen.getByText(/never counted as real bank spending/)).toBeTruthy();
    expect(screen.getByText('Walmart')).toBeTruthy();
    expect(screen.getByText('Coffee Shop')).toBeTruthy();
    expect(screen.getByText('RC-7F3A-19C2')).toBeTruthy();
  });
});

describe('Cards', () => {
  it('lists connected credit cards with confirmed/suggested product state', async () => {
    mockApi({
      'GET /accounts': [fixtures.account(), fixtures.account({ id: 'a2', name: 'Sapphire', mask: '1111', cardProduct: { ...fixtures.product, productName: 'Chase Sapphire Preferred' }, cardProductConfirmed: false })],
      'GET /reclaimed-cards': [fixtures.card()],
    });
    await renderScreen(<Cards />);
    expect(await screen.findByText(/Product unconfirmed/)).toBeTruthy();
    expect(screen.getByText(/Chase Sapphire Preferred \(suggested\)/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('account-a1'));
    expect(router.push).toHaveBeenCalledWith('/accounts/a1');
  });

  it('shows an empty state that leads to Plaid onboarding', async () => {
    mockApi({ 'GET /accounts': [], 'GET /reclaimed-cards': [] });
    await renderScreen(<Cards />);
    expect(await screen.findByText('No credit cards connected')).toBeTruthy();
  });
});

describe('Card details', () => {
  it('shows balances, statement details and product status', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'a1' });
    mockApi({
      'GET /accounts/a1': fixtures.account({ cardProduct: fixtures.product, cardProductConfirmed: true }),
      'GET /accounts/a1/liabilities': { financialAccountId: 'a1', lastStatementBalanceCents: 38010, minimumPaymentCents: 3500, nextPaymentDueDate: '2026-10-12', lastStatementIssueDate: '2026-09-15', aprs: [{ aprType: 'purchase_apr', aprPercentage: 24.99 }], isOverdue: false, updatedAt: '2026-10-10T00:00:00Z' },
      'GET /accounts/a1/transactions': { items: [fixtures.bankTxn], nextCursor: null },
    });
    await renderScreen(<AccountDetails />);
    expect(await screen.findByText('Citi Double Cash')).toBeTruthy();
    expect(screen.getByText('Confirmed by you')).toBeTruthy();
    expect(await screen.findByText('$380.10')).toBeTruthy();
    expect(screen.getByText('24.99%')).toBeTruthy();
  });

  it('lets the user confirm a seeded product', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'a1' });
    const calls = mockApi({
      'GET /accounts/a1': fixtures.account(),
      'GET /accounts/a1/card-product-matches': { matches: [{ product: fixtures.product, confidence: 0.9, reason: 'Issuer and product name match' }], ambiguous: false },
      'GET /card-products': [fixtures.product],
      'PUT /accounts/a1/card-product': fixtures.account({ cardProduct: fixtures.product, cardProductConfirmed: true }),
    });
    await renderScreen(<ConfirmProduct />);
    await fireEvent.press(await screen.findByTestId('product-citi-double-cash'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && (c.body as { cardProductId: string }).cardProductId === 'p-dc')).toBe(true));
  });
});

describe('Activity', () => {
  it('separates simulated Reclaimed transactions from Plaid transactions', async () => {
    mockApi({
      'GET /simulated-transactions': { items: [fixtures.simTxn()], nextCursor: null },
      'GET /transactions': { items: [fixtures.bankTxn], nextCursor: null },
    });
    await renderScreen(<Activity />);
    expect(await screen.findByText('Walmart')).toBeTruthy();
    expect(screen.queryByText('Coffee Shop')).toBeNull();
    await fireEvent.press(screen.getByText('Bank (Plaid)'));
    expect(await screen.findByText('Coffee Shop')).toBeTruthy();
    expect(screen.queryByText('Walmart')).toBeNull();
  });
});

describe('Payments', () => {
  it('shows the TEST MODE banner, reported balances and missing liability fields honestly', async () => {
    mockApi({
      'GET /bill-pay/accounts': [{ account: fixtures.account(), liability: null }],
      'GET /bill-pay/payments': { items: [], nextCursor: null },
    });
    await renderScreen(<Payments />);
    expect(await screen.findByText('TEST MODE — NO REAL MONEY MOVED')).toBeTruthy();
    expect(await screen.findByText('$410.55')).toBeTruthy();
    expect(screen.getAllByText('Not available').length).toBe(3);
  });
});

describe('Settings', () => {
  it('shows profile and institutions and lets the user disconnect', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    const calls = mockApi({
      'DELETE /plaid/items/i1': { removed: true },
      'GET /me': { id: 'u', email: 'ada@example.com', fullName: 'Ada', status: 'ACTIVE', themePreference: 'system', createdAt: '' },
      'GET /plaid/items': [{ id: 'i1', institutionId: 'ins', institutionName: 'Citibank Online', status: 'LOGIN_REQUIRED', lastSyncedAt: null, lastError: null, accountCount: 2, createdAt: '' }],
    });
    await renderScreen(<Settings />);
    expect(await screen.findByText('Citibank Online')).toBeTruthy();
    expect(screen.getAllByText('Reconnect').length).toBeGreaterThan(0);
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('Log out')).toBeTruthy();
    await fireEvent.press(screen.getByText('Disconnect'));
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', path: '/plaid/items/i1', body: undefined }));
    alert.mockRestore();
  });
});

describe('Reclaimed card', () => {
  it('shows enrollment, funding and freezes the card', async () => {
    const calls = mockApi({
      'GET /reclaimed-cards': [fixtures.card()],
      'GET /mock-funding-accounts': fixtures.funding,
      'GET /hardware/status': fixtures.hardware,
      'GET /reclaimed-cards/c1/transactions': { items: [fixtures.simTxn()], nextCursor: null },
      'PATCH /reclaimed-cards/c1/status': fixtures.card({ status: 'FROZEN' }),
    });
    await renderScreen(<ReclaimedCardScreen />);
    expect((await screen.findAllByText('RC-7F3A-19C2')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Mock Citi')).toBeTruthy();
    expect(screen.getByText('Mock Chase')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('freeze-toggle'));
    await waitFor(() => expect(calls).toContainEqual({ method: 'PATCH', path: '/reclaimed-cards/c1/status', body: { status: 'FROZEN' } }));
  });

  it('runs the enrollment flow until the tap completes', async () => {
    let status = 'PENDING';
    mockApi({
      'GET /hardware/status': fixtures.hardware,
      'POST /reclaimed-cards/test-enroll': { id: 'e1', status: 'PENDING', readerId: 'r1', reclaimedCardId: null, failureReason: null, expiresAt: '2026-10-10T10:01:00Z', createdAt: '' },
      'GET /reclaimed-cards/enrollments/e1': () => ({ id: 'e1', status, readerId: 'r1', reclaimedCardId: status === 'COMPLETED' ? 'c1' : null, failureReason: null, expiresAt: '2026-10-10T10:01:00Z', createdAt: '' }),
    });
    await renderScreen(<Enroll />);
    expect(await screen.findByText(/ACS ACR1252U connected/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('start-enrollment'));
    expect(await screen.findByText('Tap your card')).toBeTruthy();
    status = 'COMPLETED';
    await act(async () => { await new Promise((r) => setTimeout(r, 1700)); });
    expect(await screen.findByText('Card enrolled')).toBeTruthy();
  });
});

describe('Plaid onboarding', () => {
  it('creates a link token, opens Plaid Link and exchanges the public token', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({});
    const calls = mockApi({
      'POST /plaid/link-token': { linkToken: 'link-sandbox-1', mode: 'create' },
      'POST /plaid/exchange-token': { itemId: 'i1', accountsImported: 3 },
    });
    await renderScreen(<ConnectBank />);
    await fireEvent.press(screen.getByTestId('open-plaid'));
    expect(await screen.findByText('Imported 3 account(s).')).toBeTruthy();
    expect(calls.find((c) => c.path === '/plaid/exchange-token')?.body).toEqual({ publicToken: 'public-sandbox-123', institution: { id: 'ins_1', name: 'First Platypus Bank' } });
  });
});
