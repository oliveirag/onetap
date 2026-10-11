/**
 * API response shapes (JSON, camelCase). Monetary values ending in `Cents`
 * are integer minor units. Values from Plaid are reported, read-only data;
 * values on mock/simulated objects never touch real accounts.
 */
import type {
  AuthorizationResult,
  BillPaymentScenario,
  BillPaymentState,
  CardNetwork,
  HardwareEventType,
  MockFundingKind,
  MockFundingStatus,
  NfcEnrollmentStatus,
  PaymentState,
  PlaidItemStatus,
  ReclaimedCardStatus,
  TapOutcome,
} from './enums';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ProfileDto {
  id: string;
  email: string | null;
  fullName: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  themePreference: 'system' | 'light' | 'dark';
  createdAt: string;
}

export interface PlaidItemDto {
  id: string;
  institutionId: string | null;
  institutionName: string | null;
  status: PlaidItemStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  accountCount: number;
  createdAt: string;
}

export interface CardProductDto {
  id: string;
  issuerName: string;
  productName: string;
  productSlug: string;
  cardNetwork: CardNetwork;
}

export interface CardProductMatchDto {
  product: CardProductDto;
  /** 0..1 heuristic text similarity — not a rewards score. */
  confidence: number;
  reason: string;
}

export interface FinancialAccountDto {
  id: string;
  plaidItemId: string;
  institutionName: string | null;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalanceCents: number | null;
  availableBalanceCents: number | null;
  creditLimitCents: number | null;
  isoCurrencyCode: string | null;
  balanceUpdatedAt: string | null;
  connectionStatus: PlaidItemStatus;
  cardProduct: CardProductDto | null;
  cardProductConfirmed: boolean;
}

export interface LiabilityDto {
  financialAccountId: string;
  lastStatementBalanceCents: number | null;
  minimumPaymentCents: number | null;
  nextPaymentDueDate: string | null;
  lastStatementIssueDate: string | null;
  aprs: { aprType: string; aprPercentage: number }[];
  isOverdue: boolean | null;
  updatedAt: string;
}

export interface BankTransactionDto {
  id: string;
  financialAccountId: string;
  accountName: string | null;
  name: string;
  merchantName: string | null;
  amountCents: number;
  isoCurrencyCode: string | null;
  date: string;
  pending: boolean;
  category: string | null;
}

export interface MockFundingAccountDto {
  id: string;
  displayName: string;
  fictionalIssuer: string;
  kind: MockFundingKind;
  cardProduct: CardProductDto | null;
  creditLimitCents: number;
  currentBalanceCents: number;
  pendingHoldsCents: number;
  availableCents: number;
  status: MockFundingStatus;
  priority: number;
}

export interface ReclaimedCardDto {
  id: string;
  /** Human-friendly test card ID (e.g. RC-7F3A-19C2). */
  displayId: string;
  nickname: string | null;
  status: ReclaimedCardStatus;
  /** Null while the OneTap card is digital only (no physical NFC card attached yet). */
  uidMasked: string | null;
  cardTechnology: string | null;
  primaryFundingAccountId: string | null;
  secondaryFundingAccountId: string | null;
  fallbackEnabled: boolean;
  perTransactionLimitCents: number;
  dailyLimitCents: number;
  enrolledAt: string | null;
  lastTappedAt: string | null;
  /** True when mapped to a Lithic Sandbox virtual card (token only). */
  lithicSandboxMapped: boolean;
}

export interface EnrollmentDto {
  id: string;
  status: NfcEnrollmentStatus;
  readerId: string | null;
  reclaimedCardId: string | null;
  failureReason: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface FundingAttemptDto {
  fundingAccountId: string;
  fundingAccountName: string;
  sequence: number;
  result: AuthorizationResult;
  reason: string | null;
}

export interface AuthorizationDto {
  id: string;
  paymentTransactionId: string;
  result: AuthorizationResult;
  declineReason: string | null;
  processor: string;
  fundingAttempts: FundingAttemptDto[];
  latency: {
    totalMs: number;
    dbLookupMs: number;
    fundingEvaluationMs: number;
    processorMs: number;
  };
  createdAt: string;
}

export interface SimulatedTransactionDto {
  id: string;
  reference: string;
  terminalId: string;
  merchantId: string;
  merchantName: string;
  mcc: string;
  amountCents: number;
  currency: string;
  state: PaymentState;
  authorizationResult: AuthorizationResult | null;
  declineReason: string | null;
  reclaimedCardId: string | null;
  fundingAccountId: string | null;
  fundingAccountName: string | null;
  capturedCents: number;
  refundedCents: number;
  processor: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  /** Always true: this transaction never moved real money. */
  simulated: true;
}

export interface LedgerEntryDto {
  ledgerAccountCode: string;
  direction: 'DEBIT' | 'CREDIT';
  amountCents: number;
}

export interface LedgerJournalDto {
  id: string;
  journalType: string;
  description: string;
  entries: LedgerEntryDto[];
  createdAt: string;
}

export interface BillPaymentDto {
  id: string;
  financialAccountId: string;
  financialAccountName: string | null;
  fundingAccountId: string;
  fundingAccountName: string | null;
  amountCents: number;
  currency: string;
  state: BillPaymentState;
  scenario: BillPaymentScenario;
  failureReason: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  events: { state: BillPaymentState; note: string | null; createdAt: string }[];
  testMode: true;
}

export interface BillPayAccountDto {
  account: FinancialAccountDto;
  liability: LiabilityDto | null;
}

export interface HardwareReaderDto {
  id: string;
  readerName: string;
  bridgeId: string;
  model: string | null;
  connected: boolean;
  lastSeenAt: string | null;
  lastCardPresentAt: string | null;
  lastCardRemovedAt: string | null;
  lastCardType: string | null;
  lastUidMasked: string | null;
  lastError: string | null;
}

export interface HardwareTapDto {
  id: string;
  readerId: string | null;
  uidMasked: string;
  cardType: string | null;
  outcome: TapOutcome;
  paymentTransactionId: string | null;
  enrollmentId: string | null;
  createdAt: string;
}

export interface HardwareStatusDto {
  readers: HardwareReaderDto[];
  bridgeConnected: boolean;
  recentTaps: HardwareTapDto[];
  recentEvents: { type: HardwareEventType; readerName: string; occurredAt: string; detail: unknown }[];
  paymentMode: string;
  lithic: { configured: boolean; environment: string | null; asaEnabled: boolean };
  pendingCheckout: SimulatedTransactionDto | null;
  latestAuthorization: AuthorizationDto | null;
}

export interface TapResultDto {
  tapId: string;
  outcome: TapOutcome;
  message: string;
  enrollment?: EnrollmentDto;
  transaction?: SimulatedTransactionDto;
  authorization?: AuthorizationDto;
}

export interface DashboardSummaryDto {
  real: {
    connectedCreditCards: number;
    totalKnownCreditBalanceCents: number;
    institutions: { id: string; name: string | null; status: PlaidItemStatus; lastSyncedAt: string | null }[];
    recentTransactions: BankTransactionDto[];
    lastSyncedAt: string | null;
  };
  simulated: {
    reclaimedCard: ReclaimedCardDto | null;
    recentTransactions: SimulatedTransactionDto[];
    mockFundingAccounts: MockFundingAccountDto[];
  };
}
