import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import type {
  AuthorizationDto,
  BankTransactionDto,
  BillPayAccountDto,
  BillPaymentDto,
  CardProductDto,
  CardProductMatchDto,
  CreateBillPaymentInput,
  CreateMockFundingAccountInput,
  DashboardSummaryDto,
  EnrollmentDto,
  FinancialAccountDto,
  HardwareStatusDto,
  LedgerJournalDto,
  LiabilityDto,
  MockFundingAccountDto,
  Page,
  PlaidItemDto,
  ProfileDto,
  ReclaimedCardDto,
  SimulatedTransactionDto,
  UpdateCardFundingInput,
} from '@reclaimed/shared';
import { api, newIdempotencyKey } from './api';

export const qk = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  items: ['plaid-items'] as const,
  accounts: (type?: string) => ['accounts', type ?? 'all'] as const,
  account: (id: string) => ['account', id] as const,
  liability: (id: string) => ['liability', id] as const,
  matches: (id: string) => ['matches', id] as const,
  bankTxns: (p: object) => ['bank-txns', p] as const,
  products: (q: string) => ['card-products', q] as const,
  cards: ['reclaimed-cards'] as const,
  funding: ['mock-funding'] as const,
  simTxns: (p: object) => ['sim-txns', p] as const,
  simTxn: (id: string) => ['sim-txn', id] as const,
  enrollment: (id: string) => ['enrollment', id] as const,
  billAccounts: ['bill-accounts'] as const,
  billPayments: ['bill-payments'] as const,
  billPayment: (id: string) => ['bill-payment', id] as const,
  hardware: ['hardware-status'] as const,
};

const qs = (p: Record<string, string | number | undefined>) => {
  const s = Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  return s ? `?${s}` : '';
};

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api<ProfileDto>('GET', '/me') });
export const useDashboard = () => useQuery({ queryKey: qk.dashboard, queryFn: () => api<DashboardSummaryDto>('GET', '/dashboard/summary') });
export const usePlaidItems = () => useQuery({ queryKey: qk.items, queryFn: () => api<PlaidItemDto[]>('GET', '/plaid/items') });
export const useAccounts = (type?: string) => useQuery({ queryKey: qk.accounts(type), queryFn: () => api<FinancialAccountDto[]>('GET', `/accounts${qs({ type })}`) });
export const useAccount = (id: string) => useQuery({ queryKey: qk.account(id), queryFn: () => api<FinancialAccountDto>('GET', `/accounts/${id}`) });
export const useLiability = (id: string) => useQuery({ queryKey: qk.liability(id), queryFn: () => api<LiabilityDto | null>('GET', `/accounts/${id}/liabilities`) });
export const useMatches = (id: string) => useQuery({ queryKey: qk.matches(id), queryFn: () => api<{ matches: CardProductMatchDto[]; ambiguous: boolean }>('GET', `/accounts/${id}/card-product-matches`) });
export const useBankTransactions = (p: { search?: string; accountId?: string; limit?: number }) =>
  useQuery({ queryKey: qk.bankTxns(p), queryFn: () => api<Page<BankTransactionDto>>('GET', p.accountId ? `/accounts/${p.accountId}/transactions${qs({ search: p.search, limit: p.limit })}` : `/transactions${qs({ search: p.search, limit: p.limit })}`) });
export const useCardProducts = (search: string) => useQuery({ queryKey: qk.products(search), queryFn: () => api<CardProductDto[]>('GET', `/card-products${qs({ search })}`) });
export const useReclaimedCards = () => useQuery({ queryKey: qk.cards, queryFn: () => api<ReclaimedCardDto[]>('GET', '/reclaimed-cards') });
export const useMockFunding = () => useQuery({ queryKey: qk.funding, queryFn: () => api<MockFundingAccountDto[]>('GET', '/mock-funding-accounts') });
export const useSimulatedTransactions = (p: { search?: string; cardId?: string; limit?: number }) =>
  useQuery({ queryKey: qk.simTxns(p), queryFn: () => api<Page<SimulatedTransactionDto>>('GET', p.cardId ? `/reclaimed-cards/${p.cardId}/transactions${qs({ search: p.search, limit: p.limit })}` : `/simulated-transactions${qs({ search: p.search, limit: p.limit })}`) });
export const useSimulatedTransaction = (id: string) =>
  useQuery({ queryKey: qk.simTxn(id), queryFn: () => api<{ transaction: SimulatedTransactionDto; authorization: AuthorizationDto | null; ledger: LedgerJournalDto[] }>('GET', `/simulated-transactions/${id}`) });
export const useEnrollment = (id: string | null) =>
  useQuery({ queryKey: qk.enrollment(id ?? 'none'), enabled: Boolean(id), refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 1500 : false), queryFn: () => api<EnrollmentDto>('GET', `/reclaimed-cards/enrollments/${id}`) });
export const useBillPayAccounts = () => useQuery({ queryKey: qk.billAccounts, queryFn: () => api<BillPayAccountDto[]>('GET', '/bill-pay/accounts') });
export const useBillPayments = () => useQuery({ queryKey: qk.billPayments, queryFn: () => api<Page<BillPaymentDto>>('GET', '/bill-pay/payments') });
export const useBillPayment = (id: string) =>
  useQuery({ queryKey: qk.billPayment(id), refetchInterval: (q) => (['SUBMITTED', 'PROCESSING'].includes(q.state.data?.state ?? '') ? 2000 : false), queryFn: () => api<BillPaymentDto>('GET', `/bill-pay/payments/${id}`) });
export const useHardwareStatus = (enabled = true) => useQuery({ queryKey: qk.hardware, enabled, refetchInterval: enabled ? 3000 : false, queryFn: () => api<HardwareStatusDto>('GET', '/hardware/status') });

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: readonly unknown[][]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

export function useMutations() {
  const invalidate = useInvalidate();
  return {
    updateProfile: useMutation({ mutationFn: (b: { fullName?: string; themePreference?: string }) => api<ProfileDto>('PATCH', '/me', b), onSuccess: () => invalidate([...qk.me]) }),
    deleteAccount: useMutation({ mutationFn: () => api<{ deleted: boolean }>('DELETE', '/me') }),
    linkToken: useMutation({
      mutationFn: (itemId?: string) =>
        api<{ linkToken: string; mode: string }>('POST', '/plaid/link-token', {
          ...(itemId ? { itemId } : {}),
          ...(Platform.OS === 'ios' || Platform.OS === 'android' ? { platform: Platform.OS } : {}),
        }),
    }),
    exchange: useMutation({
      mutationFn: (b: { publicToken: string; institution?: { id?: string; name?: string } }) => api<{ itemId: string; accountsImported: number }>('POST', '/plaid/exchange-token', b),
      onSuccess: () => invalidate([...qk.items], ['accounts'], [...qk.dashboard], ['bank-txns']),
    }),
    syncItem: useMutation({ mutationFn: (id: string) => api('POST', `/plaid/items/${id}/sync`), onSuccess: () => invalidate([...qk.items], ['accounts'], [...qk.dashboard], ['bank-txns'], ['liability']) }),
    removeItem: useMutation({ mutationFn: (id: string) => api('DELETE', `/plaid/items/${id}`), onSuccess: () => invalidate([...qk.items], ['accounts'], [...qk.dashboard], ['bank-txns']) }),
    confirmProduct: useMutation({
      mutationFn: (b: { accountId: string; cardProductId: string | null }) => api<FinancialAccountDto>('PUT', `/accounts/${b.accountId}/card-product`, { cardProductId: b.cardProductId }),
      onSuccess: (_d, b) => invalidate(['accounts'], [...qk.account(b.accountId)], [...qk.dashboard]),
    }),
    startEnrollment: useMutation({ mutationFn: (b: { nickname?: string; readerId?: string }) => api<EnrollmentDto>('POST', '/reclaimed-cards/test-enroll', b) }),
    cancelEnrollment: useMutation({ mutationFn: (id: string) => api<EnrollmentDto>('POST', `/reclaimed-cards/enrollments/${id}/cancel`) }),
    setCardStatus: useMutation({ mutationFn: (b: { id: string; status: 'ACTIVE' | 'FROZEN' | 'REVOKED' }) => api<ReclaimedCardDto>('PATCH', `/reclaimed-cards/${b.id}/status`, { status: b.status }), onSuccess: () => invalidate([...qk.cards], [...qk.dashboard]) }),
    setCardFunding: useMutation({ mutationFn: (b: { id: string } & UpdateCardFundingInput) => api<ReclaimedCardDto>('PUT', `/reclaimed-cards/${b.id}/funding`, { ...b, id: undefined }), onSuccess: () => invalidate([...qk.cards], [...qk.dashboard]) }),
    demoSetup: useMutation({ mutationFn: (cardId?: string) => api('POST', '/mock-funding-accounts/demo-setup', cardId ? { reclaimedCardId: cardId } : {}), onSuccess: () => invalidate([...qk.funding], [...qk.cards], [...qk.dashboard]) }),
    createFunding: useMutation({ mutationFn: (b: CreateMockFundingAccountInput) => api<MockFundingAccountDto>('POST', '/mock-funding-accounts', b), onSuccess: () => invalidate([...qk.funding], [...qk.dashboard]) }),
    updateFunding: useMutation({ mutationFn: (b: { id: string; displayName?: string; status?: string; creditLimitCents?: number; currentBalanceCents?: number }) => api<MockFundingAccountDto>('PATCH', `/mock-funding-accounts/${b.id}`, { ...b, id: undefined }), onSuccess: () => invalidate([...qk.funding], [...qk.dashboard]) }),
    provisionLithic: useMutation({ mutationFn: (id: string) => api<ReclaimedCardDto>('POST', `/reclaimed-cards/${id}/lithic-card`), onSuccess: () => invalidate([...qk.cards]) }),
    createBillPayment: useMutation({
      mutationFn: (b: CreateBillPaymentInput) => api<BillPaymentDto>('POST', '/bill-pay/payments', b, { idempotencyKey: newIdempotencyKey() }),
      onSuccess: () => invalidate([...qk.billPayments], [...qk.funding]),
    }),
    cancelBillPayment: useMutation({ mutationFn: (id: string) => api<BillPaymentDto>('POST', `/bill-pay/payments/${id}/cancel`), onSuccess: (_d, id) => invalidate([...qk.billPayments], [...qk.billPayment(id)], [...qk.funding]) }),
  };
}
